import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BadgeVerificationMethod, ClaimStatus, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { CandidateSkillClaim, JobSkillRequirement, scoreCandidate } from './scoring';

/** LLM explanations are the expensive part — only ever generated for the top N. */
const TOP_N_MATCHES = 10;

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
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

      const result = scoreCandidate(
        jobSkills,
        claimsBySkillId,
        profile.yearsOfExp,
        job.experienceMin,
        job.experienceMax,
      );

      return {
        profileId: profile.id,
        fullName: profile.fullName,
        headline: profile.headline,
        location: profile.location,
        yearsOfExp: profile.yearsOfExp,
        score: result.score,
        matched: result.matched
          .map((m) => ({
            skillId: m.skillId,
            skillName: m.skillName,
            level: m.candidateLevel as SkillLevel, // matched entries always have a claim
            verifiedBy: claimRowsBySkillId.get(m.skillId)?.badge?.verifiedBy,
            verifyHash: claimRowsBySkillId.get(m.skillId)?.badge?.verifyHash,
          }))
          .filter(
            (
              m,
            ): m is { skillId: string; skillName: string; level: SkillLevel; verifiedBy: BadgeVerificationMethod; verifyHash: string } =>
              !!m.verifyHash,
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

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, TOP_N_MATCHES);

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
