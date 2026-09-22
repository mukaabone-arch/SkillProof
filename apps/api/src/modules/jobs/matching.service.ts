import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BadgeVerificationMethod, CertVerificationStatus, ClaimStatus, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { PLANS } from '../../config/plans.config';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { formatLocation } from '../locations/location-format.util';
import { candidateVisibilityFilter } from '../account/account.util';
import { CandidateSkillClaim, JobSkillRequirement, compareByMatchRank, scoreCandidate } from './scoring';

/** LLM explanations are the expensive part — only ever generated for the top N. */
const TOP_N_MATCHES = 10;

/**
 * Job-to-Talent Match funnel tiers — bands over scoreCandidate's own 0-100
 * output, not a second scorer. Mirrors apps/web/lib/matchBand.ts's
 * thresholds (strong>=75, good>=50, partial>=25) exactly; kept as a second
 * literal copy rather than an import because apps/api and apps/web are
 * separate TS projects with no shared package — if matchBand.ts's
 * thresholds ever change, update these too.
 *
 * VERIFIED_MATCH_MIN is a mathematical property of scoreCandidate, not an
 * extra filter: the richest an all-unverified candidate can score is
 * UNVERIFIED_AT_OR_ABOVE_LEVEL_CREDIT (0.4) per skill, capping skillPercent
 * at 40, plus at most +5 from experienceAdjustment — 45, still short of 50.
 * No candidate crosses this line without >=1 verified claim or
 * certification, so "Verified match" is an honest label, not a marketing
 * one.
 */
const RELEVANT_MIN = 25;
const VERIFIED_MATCH_MIN = 50;
const STRONG_MATCH_MIN = 75;

export interface MatchFunnel {
  considered: number;
  relevant: number;
  verifiedMatch: number;
  strongMatch: number;
}

const EMPTY_FUNNEL: MatchFunnel = { considered: 0, relevant: 0, verifiedMatch: 0, strongMatch: 0 };

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
      return {
        jobId: job.id,
        jobTitle: job.title,
        funnel: EMPTY_FUNNEL,
        unmatchedRequiredSkills: [],
        candidates: [],
        allCandidates: [],
      };
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
        ...candidateVisibilityFilter,
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
        // Display only, not matching input — formatLocation just keeps
        // this in sync with the structured-location migration; score
        // above is computed entirely from scoreCandidate, untouched here.
        location: formatLocation(profile),
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

    // Every number below is a count of rows in `ranked` — the exact pool
    // that cleared the privacy gate above — never padded, estimated, or
    // rounded. Naturally nested (strongMatch <= verifiedMatch <= relevant
    // <= considered) because each is just a higher score threshold over the
    // same pool, not a separate query.
    const funnel: MatchFunnel = {
      considered: ranked.filter((c) => c.score > 0).length,
      relevant: ranked.filter((c) => c.score >= RELEVANT_MIN).length,
      verifiedMatch: ranked.filter((c) => c.score >= VERIFIED_MATCH_MIN).length,
      strongMatch: ranked.filter((c) => c.score >= STRONG_MATCH_MIN).length,
    };

    // Only computed for the zero-considered state (see the Job-to-Talent
    // Match page's small-number states) — telling an employer *which*
    // required skill has no verified supply at all, platform-wide, is
    // actionable in a way "0 candidates" alone isn't.
    const unmatchedRequiredSkills =
      funnel.considered === 0 ? await this.findRequiredSkillsWithNoVerifiedHolder(jobSkills) : [];

    // Lightweight, unranked-by-LLM-cost view of the FULL scored pool (not
    // just the top N) for the Job-to-Talent Match table — no aiExplanation
    // (that's the expensive part TOP_N_MATCHES exists to limit), no missing-
    // skill detail, no contact fields (those were never fetched into
    // `profiles` above, so there's nothing here to gate). verifiedSkillCount
    // reuses the same matched list (already filtered to entries with an
    // issued badge) that drives `matched` above, never re-derived.
    const allCandidates = ranked.map((c) => ({
      profileId: c.profileId,
      fullName: c.fullName,
      score: c.score,
      verifiedSkillCount: c.matched.length,
      yearsOfExp: c.yearsOfExp,
    }));

    return {
      jobId: job.id,
      jobTitle: job.title,
      funnel,
      unmatchedRequiredSkills,
      candidates: withExplanations,
      allCandidates,
    };
  }

  /**
   * For each of this job's required skills: does any visible, active
   * candidate anywhere on the platform hold a VERIFIED claim on it? Ignores
   * yearsOfExp and every other job requirement — this isn't "who matches
   * this job," it's "does this skill have any verified supply at all,"
   * which is what an employer can actually act on by editing the job.
   * Deliberately skillClaims-only, not certifiedSkillIds — see getMatches'
   * own comment on why a certification alone never seeds the scored pool
   * either; this stays consistent with that gate rather than inventing a
   * second, looser one.
   */
  private async findRequiredSkillsWithNoVerifiedHolder(
    jobSkills: JobSkillRequirement[],
  ): Promise<{ skillId: string; skillName: string }[]> {
    const requiredSkills = jobSkills.filter((s) => s.isRequired);
    if (requiredSkills.length === 0) return [];

    const holders = await this.prisma.skillClaim.findMany({
      where: {
        skillId: { in: requiredSkills.map((s) => s.skillId) },
        status: ClaimStatus.VERIFIED,
        profile: candidateVisibilityFilter,
      },
      select: { skillId: true },
      distinct: ['skillId'],
    });
    const withHolderIds = new Set(holders.map((h) => h.skillId));
    return requiredSkills.filter((s) => !withHolderIds.has(s.skillId)).map((s) => ({ skillId: s.skillId, skillName: s.skillName }));
  }
}
