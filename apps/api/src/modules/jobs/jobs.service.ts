import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CertVerificationStatus, ClaimStatus, CredentialVerificationState, JobStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { ProfilesService } from '../profiles/profiles.service';
import { EmployerCandidateAccessService } from '../access/employer-candidate-access.service';
import { CandidateSkillClaim, JobSkillRequirement, scoreCandidate } from './scoring';
import { CreateJobDto, JobSkillItemDto, UpdateJobDto } from './jobs.dto';
import { isProfileReadyToApply } from '../profiles/profile-readiness';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly profiles: ProfilesService,
    private readonly employerAccess: EmployerCandidateAccessService,
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
   * Employer-facing applicant list for one job — the evaluation surface an
   * employer decides from. Same privacy model as CandidatesService.search():
   * only public profile fields plus VERIFIED skill claims with a badge to
   * link to — no phone, no email, no unverified claim details. The match
   * score is computed with the exact same `scoreCandidate` (scoring.ts)
   * used everywhere else; it's the only place an unverified claim is
   * allowed to influence anything, and even then only as a number, never
   * surfaced as claim detail.
   *
   * hasPhoto/hasResume are booleans only — never the raw photoKey/
   * resumeS3Key — same "never hand a client the storage key" rule as
   * ProfilesService.withHasPhoto. The actual bytes are reachable only
   * through GET /profiles/:id/photo and GET /jobs/:jobId/applicants/:candidateId/resume,
   * each independently re-checking employerCanViewCandidate; this list
   * itself needs no such check per row — every candidateProfile here is
   * already an applicant to the employer's own job, by construction of the
   * `where: { jobId }` query below (and getOwnedJob's org check on jobId).
   *
   * externalCredentials are surfaced alongside but kept out of scoring
   * entirely (per scoring.ts's separation from the external-credentials
   * system) — only VERIFIED ones are returned, so the employer judges
   * relevance themselves rather than us presenting an unverified claim.
   * (This list is the older, Credly-only ExternalCredential table; it's
   * left as-is here deliberately — see Certification's doc comment in
   * schema.prisma. Certification's own VERIFIED skill tags DO feed the
   * `score` number below, same as MatchingService, but aren't yet
   * surfaced as their own list on this card — a separate follow-up.)
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
            // Score-only — see this method's doc comment. Same VERIFIED/
            // non-expired/relevant-tags filter as MatchingService.
            certifications: {
              where: {
                verificationStatus: CertVerificationStatus.VERIFIED,
                skillTags: { hasSome: jobSkills.map((s) => s.skillId) },
                OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
              },
              select: { skillTags: true },
            },
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
      const certifiedSkillIds = new Set(profile.certifications.flatMap((c) => c.skillTags));

      const score =
        jobSkills.length > 0
          ? scoreCandidate(
              jobSkills,
              claimsBySkillId,
              certifiedSkillIds,
              profile.yearsOfExp,
              job.experienceMin,
              job.experienceMax,
            ).score
          : null;

      return {
        applicationId: app.id,
        status: app.status,
        appliedAt: app.createdAt,
        profileId: profile.id,
        fullName: profile.fullName,
        headline: profile.headline,
        roleTitle: profile.roleTitle,
        roleTitleOther: profile.roleTitleOther,
        location: profile.location,
        yearsOfExp: profile.yearsOfExp,
        githubUrl: profile.githubUrl,
        linkedinUrl: profile.linkedinUrl,
        hasPhoto: profile.photoKey != null,
        hasResume: profile.resumeS3Key != null,
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
            verifiedBy: c.badge!.verifiedBy,
            verifyHash: c.badge!.verifyHash,
            // Employer-facing credibility — null for session-issued badges (see Badge.attemptNumber's doc comment).
            attemptNumber: c.badge!.attemptNumber,
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

  /**
   * GET /jobs/:jobId/applicants/:candidateId/resume. jobId is validated as
   * this org's own (getOwnedJob — 404/403 for a foreign or missing job,
   * consistent with every other job-scoped route); the actual "may this
   * employer see this candidate's resume" decision is
   * employerCanViewCandidate, the same check gating the photo proxy
   * (ProfilesService.assertCanViewPhoto), checked against ANY job this org
   * owns, not just jobId — an applicant to one of the org's other jobs is
   * still a legitimate relationship even if this exact jobId isn't the one
   * they applied to.
   *
   * Order matters for the spec'd error codes: relationship (403) is
   * checked before resume existence (404), so a candidate who never
   * applied to this org never learns whether they have a resume on file.
   */
  async getApplicantResume(orgId: string, jobId: string, candidateId: string) {
    await this.getOwnedJob(orgId, jobId);

    const allowed = await this.employerAccess.employerCanViewCandidate(orgId, candidateId);
    if (!allowed) throw new ForbiddenException();

    return this.profiles.getResumeForCandidate(candidateId);
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
