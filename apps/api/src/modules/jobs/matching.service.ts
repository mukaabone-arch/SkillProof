import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BadgeVerificationMethod, CertVerificationStatus, ClaimStatus, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { PLANS } from '../../config/plans.config';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { formatCandidateLocation } from '../profiles/location-format.util';
import { CandidateSkillClaim, JobSkillRequirement, compareByMatchRank, scoreCandidate } from './scoring';

/** LLM explanations are the expensive part — only ever generated for the top N. */
const TOP_N_MATCHES = 10;

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async getMatches(orgId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { skills: { include: { skill: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.orgId !== orgId) throw new ForbiddenException();

    if (job.skills.length === 0) {
      return { jobId: job.id, jobTitle: job.title, candidates: [] };
    }

    const jobSkills: JobSkillRequirement[] = job.skills.map((js) => ({
      skillId: js.skillId,
      skillName: js.skill.name,
      requiredLevel: js.requiredLevel,
      isRequired: js.isRequired,
    }));
    const jobSkillIds = jobSkills.map((s) => s.skillId);

    // Same privacy gate as candidate search — a candidate only appears at all
    // if they have >=1 VERIFIED claim somewhere — further narrowed to those
    // with any claim (verified or not) on a skill this job actually asks for,
    // so we don't score the entire candidate pool against an unrelated job.
    // Deliberately NOT widened to admit candidates whose only proof is a
    // verified Certification with no SkillClaim at all — that's a separate,
    // bigger product decision about employer-facing candidate discovery.
    // certifiedSkillIds below only ever raises the score of a candidate who
    // already cleared this gate; it never lets someone new into the pool.
    const profiles = await this.prisma.candidateProfile.findMany({
      where: {
        deletedAt: null,
        AND: [
          { skillClaims: { some: { status: ClaimStatus.VERIFIED } } },
          { skillClaims: { some: { skillId: { in: jobSkillIds } } } },
        ],
      },
      include: {
        skillClaims: {
          where: { skillId: { in: jobSkillIds } },
          include: { skill: true, badge: true },
        },
        // Only VERIFIED, non-expired rows, and only tags relevant to this
        // job — see scoring.ts's certifiedSkillIds contract. LINK_PROVIDED/
        // SELF_REPORTED certifications must never reach scoreCandidate.
        certifications: {
          where: {
            verificationStatus: CertVerificationStatus.VERIFIED,
            skillTags: { hasSome: jobSkillIds },
            OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
          },
          select: { skillTags: true },
        },
      },
    });

    const scored = profiles.map((profile) => {
      const claimsBySkillId = new Map<string, CandidateSkillClaim>();
      for (const claim of profile.skillClaims) {
        claimsBySkillId.set(claim.skillId, {
          skillId: claim.skillId,
          level: claim.level,
          verified: claim.status === ClaimStatus.VERIFIED,
        });
      }
      const claimRowsBySkillId = new Map(profile.skillClaims.map((c) => [c.skillId, c]));
      const certifiedSkillIds = new Set(profile.certifications.flatMap((c) => c.skillTags));

      const result = scoreCandidate(
        jobSkills,
        claimsBySkillId,
        certifiedSkillIds,
        profile.yearsOfExp,
        job.experienceMin,
        job.experienceMax,
      );

      return {
        profileId: profile.id,
        fullName: profile.fullName,
        headline: profile.headline,
        // Display only, not matching input — formatCandidateLocation just
        // keeps this in sync with the structured-location migration; score
        // above is computed entirely from scoreCandidate, untouched here.
        location: formatCandidateLocation(profile),
        yearsOfExp: profile.yearsOfExp,
        score: result.score,
        matched: result.matched
          .map((m) => ({
            skillId: m.skillId,
            skillName: m.skillName,
            level: m.candidateLevel as SkillLevel, // matched entries always have a claim
            verifiedBy: claimRowsBySkillId.get(m.skillId)?.badge?.verifiedBy,
            verifyHash: claimRowsBySkillId.get(m.skillId)?.badge?.verifyHash,
            // Employer-facing credibility — "earned on attempt #N" — null for
            // session-issued badges (see Badge.attemptNumber's doc comment).
            attemptNumber: claimRowsBySkillId.get(m.skillId)?.badge?.attemptNumber ?? null,
          }))
          .filter(
            (
              m,
            ): m is {
              skillId: string;
              skillName: string;
              level: SkillLevel;
              verifiedBy: BadgeVerificationMethod;
              verifyHash: string;
              attemptNumber: number | null;
            } => !!m.verifyHash,
          ),
        missing: result.missing.map((m) => ({
          skillId: m.skillId,
          skillName: m.skillName,
          requiredLevel: m.requiredLevel,
          candidateLevel: m.candidateLevel,
          verified: m.verified,
        })),
      };
    });

    // searchRankBoost tiebreaker — see scoring.ts's compareByMatchRank doc
    // comment. tierBoost is purely a sort key, never added to `score` and
    // never returned to the client.
    const tiersByProfileId = await this.entitlements.resolveEffectiveTiersForCandidates(
      scored.map((c) => c.profileId),
    );
    const ranked = scored
      .map((c) => ({ ...c, tierBoost: PLANS[tiersByProfileId.get(c.profileId)!].searchRankBoost }))
      .sort(compareByMatchRank);
    const top = ranked.slice(0, TOP_N_MATCHES).map(({ tierBoost, ...rest }) => rest);

    const withExplanations = await Promise.all(
      top.map(async (c) => ({
        ...c,
        aiExplanation: await this.llm.explainMatch({
          matched: c.matched.map((m) => ({ skillName: m.skillName, level: m.level })),
          missing: c.missing.map((m) => ({
            skillName: m.skillName,
            requiredLevel: m.requiredLevel,
            candidateLevel: m.candidateLevel,
            verified: m.verified,
          })),
        }),
      })),
    );

    return { jobId: job.id, jobTitle: job.title, candidates: withExplanations };
  }
}
