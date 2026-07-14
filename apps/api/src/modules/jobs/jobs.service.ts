import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClaimStatus, CredentialVerificationState, JobStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { CandidateSkillClaim, JobSkillRequirement, scoreCandidate } from './scoring';
import { CreateJobDto, JobSkillItemDto, UpdateJobDto } from './jobs.dto';
import { isProfileReadyToApply } from './profile-readiness';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  create(orgId: string, dto: CreateJobDto) {
    return this.prisma.job.create({ data: { orgId, ...dto } });
  }

  listForOrg(orgId: string) {
    return this.prisma.job.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { skills: { include: { skill: true } } },
    });
  }

  async update(orgId: string, jobId: string, dto: UpdateJobDto) {
    await this.getOwnedJob(orgId, jobId);
    return this.prisma.job.update({ where: { id: jobId }, data: dto });
  }

  /**
   * Draft-only: a LIVE or CLOSED job may already have Applications
   * referencing it (or simply shouldn't vanish from an employer's history
   * once candidates have seen it) — those get "Unpublish"/"Close" instead
   * (PATCH status), never a hard delete. A DRAFT job can never have
   * Applications (candidate-jobs.service only ever surfaces LIVE jobs), so
   * deleting one is always safe once its JobSkill rows are cleared first —
   * there's no ON DELETE CASCADE on that FK.
   */
  async remove(orgId: string, jobId: string) {
    const job = await this.getOwnedJob(orgId, jobId);
    if (job.status !== JobStatus.DRAFT) {
      throw new BadRequestException('Only draft jobs can be deleted — close a live job instead.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.jobSkill.deleteMany({ where: { jobId } });
      await tx.job.delete({ where: { id: jobId } });
    });
    return { ok: true };
  }

  async setSkills(orgId: string, jobId: string, items: JobSkillItemDto[]) {
    await this.getOwnedJob(orgId, jobId);

    const skillIds = items.map((i) => i.skillId);
    if (skillIds.length > 0) {
      const validCount = await this.prisma.skill.count({ where: { id: { in: skillIds } } });
      if (validCount !== new Set(skillIds).size) {
        throw new BadRequestException('One or more skillId values do not exist.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.jobSkill.deleteMany({ where: { jobId } });
      if (items.length > 0) {
        await tx.jobSkill.createMany({
          data: items.map((i) => ({
            jobId,
            skillId: i.skillId,
            requiredLevel: i.requiredLevel,
            isRequired: i.isRequired,
          })),
        });
      }
      return tx.jobSkill.findMany({ where: { jobId }, include: { skill: true } });
    });
  }

  /**
   * Employer-facing applicant list for one job. Same privacy model as
   * CandidatesService.search(): only public profile fields plus VERIFIED
   * skill claims with a badge to link to — no phone, no email, no
   * unverified claim details. The match score is computed with the exact
   * same `scoreCandidate` (scoring.ts) used everywhere else; it's the only
   * place an unverified claim is allowed to influence anything, and even
   * then only as a number, never surfaced as claim detail.
   *
   * externalCredentials are surfaced alongside but kept out of scoring
   * entirely (per scoring.ts's separation from the external-credentials
   * system) — only VERIFIED ones are returned, so the employer judges
   * relevance themselves rather than us presenting an unverified claim.
   */
  async getApplicants(orgId: string, jobId: string) {
    await this.getOwnedJob(orgId, jobId);

    const job = await this.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { skills: { include: { skill: true } } },
    });
    const jobSkills: JobSkillRequirement[] = job.skills.map((s) => ({
      skillId: s.skillId,
      skillName: s.skill.name,
      requiredLevel: s.requiredLevel,
      isRequired: s.isRequired,
    }));

    const applications = await this.prisma.application.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
      include: {
        candidateProfile: {
          include: {
            skillClaims: { include: { skill: true, badge: true } },
            externalCredentials: { where: { verificationState: CredentialVerificationState.VERIFIED } },
          },
        },
      },
    });

    return applications.map((app) => {
      const profile = app.candidateProfile;
      const claimsBySkillId = new Map<string, CandidateSkillClaim>();
      for (const c of profile.skillClaims) {
        claimsBySkillId.set(c.skillId, {
          skillId: c.skillId,
          level: c.level,
          verified: c.status === ClaimStatus.VERIFIED,
        });
      }

      const score =
        jobSkills.length > 0
          ? scoreCandidate(jobSkills, claimsBySkillId, profile.yearsOfExp, job.experienceMin, job.experienceMax)
              .score
          : null;

      return {
        applicationId: app.id,
        status: app.status,
        appliedAt: app.createdAt,
        profileId: profile.id,
        fullName: profile.fullName,
        headline: profile.headline,
        location: profile.location,
        yearsOfExp: profile.yearsOfExp,
        // Older applications predate the apply-time profile requirement —
        // flag those explicitly rather than showing the employer a blank card.
        profileIncomplete: !isProfileReadyToApply(profile),
        score,
        verifiedSkills: profile.skillClaims
          .filter((c) => c.status === ClaimStatus.VERIFIED && c.badge)
          .map((c) => ({
            skillId: c.skillId,
            skillName: c.skill.name,
            level: c.level,
            verifyHash: c.badge!.verifyHash,
          })),
        externalCredentials: profile.externalCredentials.map((c) => ({
          id: c.id,
          issuer: c.issuer,
          name: c.name,
          credentialUrl: c.credentialUrl,
          issuedAt: c.issuedAt,
          expiresAt: c.expiresAt,
          // Advisory only — see NameMatchState. Employer weighs it, we don't act on it.
          nameMatchState: c.nameMatchState,
        })),
      };
    });
  }

  async parseDescription(description: string) {
    const skills = await this.prisma.skill.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return this.llm.extractJobFields(description, skills.map((s) => s.name));
  }

  /** IDOR protection: employers may only touch jobs in their own org. */
  private async getOwnedJob(orgId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.orgId !== orgId) throw new ForbiddenException();
    return job;
  }
}
