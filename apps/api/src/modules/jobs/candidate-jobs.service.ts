import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClaimStatus, CredentialVerificationState, JobStatus, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CandidateSkillClaim, JobSkillRequirement, scoreCandidate } from './scoring';
import { BrowseJobsDto } from './candidate-jobs.dto';
import { isProfileReadyToApply } from './profile-readiness';

/**
 * One-line flip once assessment coverage across the taxonomy is sufficient
 * to fairly require it — defaults to false (env var absent or anything other
 * than the literal string 'true'), so applying doesn't yet require a badge.
 */
const REQUIRE_VERIFIED_BADGE_TO_APPLY = process.env.REQUIRE_VERIFIED_BADGE_TO_APPLY === 'true';

/** Public fields only — no orgId, no status, nothing employer-internal. */
const JOB_LIST_SELECT = {
  id: true,
  title: true,
  employmentType: true,
  location: true,
  remote: true,
  experienceMin: true,
  experienceMax: true,
  createdAt: true,
  organization: { select: { name: true } },
  skills: {
    select: {
      skillId: true,
      requiredLevel: true,
      isRequired: true,
      skill: { select: { name: true } },
    },
  },
} satisfies Prisma.JobSelect;

const JOB_DETAIL_SELECT = {
  ...JOB_LIST_SELECT,
  description: true,
  salaryMin: true,
  salaryMax: true,
} satisfies Prisma.JobSelect;

type JobListRow = Prisma.JobGetPayload<{ select: typeof JOB_LIST_SELECT }>;
type JobDetailRow = Prisma.JobGetPayload<{ select: typeof JOB_DETAIL_SELECT }>;

@Injectable()
export class CandidateJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async browse(userId: string, dto: BrowseJobsDto) {
    const { skillId, location, remote, limit, offset } = dto;
    const where: Prisma.JobWhereInput = {
      status: JobStatus.LIVE,
      ...(location ? { location: { contains: location, mode: 'insensitive' } } : {}),
      ...(remote !== undefined ? { remote } : {}),
      ...(skillId ? { skills: { some: { skillId } } } : {}),
    };

    const [total, jobs, applied] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: JOB_LIST_SELECT,
      }),
      this.appliedJobIds(userId),
    ]);

    return {
      total,
      limit,
      offset,
      jobs: jobs.map((j) => ({ ...this.toPublicJob(j), alreadyApplied: applied.has(j.id) })),
    };
  }

  async browseOne(userId: string, id: string) {
    const job = await this.prisma.job.findFirst({
      where: { id, status: JobStatus.LIVE },
      select: JOB_DETAIL_SELECT,
    });
    if (!job) throw new NotFoundException('Job not found');

    const applied = await this.appliedJobIds(userId);
    return { ...this.toPublicJob(job), description: job.description, salaryMin: job.salaryMin,
      salaryMax: job.salaryMax, alreadyApplied: applied.has(job.id) };
  }

  /**
   * Personalized ranking of every LIVE job against the candidate's skill
   * claims. Reuses the same deterministic `scoreCandidate` used on the
   * employer side (scoring.ts) — this view never recomputes the algorithm,
   * only feeds it the candidate's own claims instead of a pool of candidates.
   * No AI narration here: score + matched/missing breakdown is enough, and
   * skipping it avoids an LLM call per job on every dashboard load.
   */
  async matched(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      include: {
        skillClaims: { include: { badge: { select: { revokedAt: true } } } },
        applications: { select: { jobId: true } },
      },
    });

    const claimsBySkillId = new Map<string, CandidateSkillClaim>();
    for (const c of profile?.skillClaims ?? []) {
      claimsBySkillId.set(c.skillId, {
        skillId: c.skillId,
        level: c.level,
        verified: c.status === ClaimStatus.VERIFIED && !!c.badge && !c.badge.revokedAt,
      });
    }

    // Matching is meaningless without at least one verified claim — every
    // job would score 0 and render as a demoralizing wall of zeros. The
    // frontend shows a dedicated "earn a badge" empty state for this case,
    // keyed off an empty list, so short-circuit before scoring anything.
    const hasVerifiedClaim = [...claimsBySkillId.values()].some((c) => c.verified);
    if (!hasVerifiedClaim) return { jobs: [] };

    const applied = new Set((profile?.applications ?? []).map((a) => a.jobId));

    const jobs = await this.prisma.job.findMany({
      where: { status: JobStatus.LIVE },
      select: JOB_LIST_SELECT,
    });

    const scored = jobs
      .filter((j) => j.skills.length > 0)
      .map((job) => {
        const jobSkills: JobSkillRequirement[] = job.skills.map((s) => ({
          skillId: s.skillId,
          skillName: s.skill.name,
          requiredLevel: s.requiredLevel,
          isRequired: s.isRequired,
        }));

        const result = scoreCandidate(
          jobSkills,
          claimsBySkillId,
          profile?.yearsOfExp ?? null,
          job.experienceMin,
          job.experienceMax,
        );

        return {
          ...this.toPublicJob(job),
          alreadyApplied: applied.has(job.id),
          score: result.score,
          matched: result.matched.map((m) => ({
            skillId: m.skillId,
            skillName: m.skillName,
            requiredLevel: m.requiredLevel,
            candidateLevel: m.candidateLevel,
            verified: m.verified,
          })),
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
    return { jobs: scored };
  }

  async apply(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { organization: { select: { name: true } } },
    });
    if (!job || job.status !== JobStatus.LIVE) throw new NotFoundException('Job not found');

    const profile = await this.ensureProfile(userId);
    this.assertProfileReadyToApply(profile);
    if (REQUIRE_VERIFIED_BADGE_TO_APPLY) {
      await this.assertHasVerifiedBadge(profile.id);
    }

    let application;
    try {
      application = await this.prisma.application.create({
        data: { candidateProfileId: profile.id, jobId },
        include: { job: { select: { id: true, title: true } } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You have already applied to this job.');
      }
      throw err;
    }

    // Best-effort — a slow/failed email must never fail the application itself.
    try {
      const subject = `You've applied to ${job.title} at ${job.organization.name}`;
      const html = `<p>You've applied to <strong>${job.title}</strong> at <strong>${job.organization.name}</strong>. The employer will review your application and you'll be notified of any status change.</p>`;
      await this.notifications.sendEmail(userId, NotificationType.APPLICATION_CONFIRMATION, subject, html);
    } catch {
      // NotificationsService already swallows its own errors; this catch is defense in depth.
    }

    return application;
  }

  private async ensureProfile(userId: string) {
    const existing = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.candidateProfile.create({ data: { userId } });
  }

  /**
   * Employers should never see a blank applicant card — require a name plus
   * at least one of headline/yearsOfExp before letting someone apply. The
   * `code` is machine-readable so the frontend can show a targeted prompt
   * (→ /profile) instead of a generic error. Uses the exact same check
   * JobsService.getApplicants uses to flag pre-existing incomplete
   * applicants, so enforcement and display can never disagree.
   */
  private assertProfileReadyToApply(profile: {
    fullName: string | null;
    headline: string | null;
    yearsOfExp: number | null;
  }): void {
    if (!isProfileReadyToApply(profile)) {
      throw new BadRequestException({
        code: 'PROFILE_INCOMPLETE',
        message:
          'Add your name and either a headline or years of experience before applying, so the employer knows who they’re reviewing.',
      });
    }
  }

  /**
   * Satisfied by either a verified SkillProof SkillClaim (currently-valid —
   * an admin-invalidated/revoked one doesn't count) or a verified external
   * credential (e.g. a Credly badge) that hasn't expired. External
   * credentials are otherwise kept fully separate from this system — this
   * gate is their only interaction with it, and they never touch scoring.
   */
  private async assertHasVerifiedBadge(profileId: string): Promise<void> {
    const [verifiedClaimCount, verifiedCredentialCount] = await Promise.all([
      this.prisma.skillClaim.count({
        where: { profileId, status: ClaimStatus.VERIFIED, badge: { revokedAt: null } },
      }),
      this.prisma.externalCredential.count({
        where: {
          profileId,
          verificationState: CredentialVerificationState.VERIFIED,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
    ]);
    if (verifiedClaimCount === 0 && verifiedCredentialCount === 0) {
      throw new BadRequestException({
        code: 'BADGE_REQUIRED',
        message: 'Earn at least one verified skill badge before applying — take an assessment to get started.',
      });
    }
  }

  private async appliedJobIds(userId: string): Promise<Set<string>> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) return new Set();

    const apps = await this.prisma.application.findMany({
      where: { candidateProfileId: profile.id },
      select: { jobId: true },
    });
    return new Set(apps.map((a) => a.jobId));
  }

  private toPublicJob(job: JobListRow | JobDetailRow) {
    return {
      id: job.id,
      title: job.title,
      orgName: job.organization.name,
      employmentType: job.employmentType,
      location: job.location,
      remote: job.remote,
      experienceMin: job.experienceMin,
      experienceMax: job.experienceMax,
      createdAt: job.createdAt,
      skills: job.skills.map((s) => ({
        skillId: s.skillId,
        skillName: s.skill.name,
        requiredLevel: s.requiredLevel,
        isRequired: s.isRequired,
      })),
    };
  }
}
