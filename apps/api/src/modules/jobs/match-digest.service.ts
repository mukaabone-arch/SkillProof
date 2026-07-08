import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClaimStatus, JobStatus, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CandidateSkillClaim, JobSkillRequirement, scoreCandidate } from './scoring';

/** Only genuinely strong matches get emailed — this is a curated digest, not a firehose. */
const MATCH_THRESHOLD = 70;

const DIGEST_JOB_SELECT = {
  id: true,
  title: true,
  experienceMin: true,
  experienceMax: true,
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

type DigestJob = Prisma.JobGetPayload<{ select: typeof DIGEST_JOB_SELECT }>;

/**
 * Daily "jobs matched to you" email digest. Scoring is delegated entirely to
 * `scoreCandidate` (scoring.ts) — the exact same deterministic function used
 * by the employer-side matching and the candidate `/jobs/matched` endpoint —
 * this service only decides *who* to score against *what* and whether a
 * match is new enough to email.
 */
@Injectable()
export class MatchDigestService {
  private readonly logger = new Logger(MatchDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async run(): Promise<void> {
    this.logger.log('Running daily match digest');
    try {
      await this.sendDigests();
    } catch {
      this.logger.error('Match digest run failed');
    }
  }

  /** Separated from the @Cron handler so it can be invoked directly (e.g. manually or in a test). */
  async sendDigests(): Promise<void> {
    const jobs = await this.prisma.job.findMany({
      where: { status: JobStatus.LIVE },
      select: DIGEST_JOB_SELECT,
    });
    const liveJobs = jobs.filter((j) => j.skills.length > 0);
    if (liveJobs.length === 0) return;

    const candidates = await this.prisma.candidateProfile.findMany({
      where: { deletedAt: null, emailNotifications: true, user: { email: { not: null } } },
      select: {
        userId: true,
        yearsOfExp: true,
        skillClaims: { select: { skillId: true, level: true, status: true } },
        applications: { select: { jobId: true } },
      },
    });
    if (candidates.length === 0) return;

    const priorDigests = await this.prisma.notification.findMany({
      where: { type: NotificationType.MATCH_DIGEST, userId: { in: candidates.map((c) => c.userId) } },
      select: { userId: true, jobIds: true },
    });
    const alreadyNotified = new Map<string, Set<string>>();
    for (const n of priorDigests) {
      const set = alreadyNotified.get(n.userId) ?? new Set<string>();
      n.jobIds.forEach((id) => set.add(id));
      alreadyNotified.set(n.userId, set);
    }

    for (const candidate of candidates) {
      const claimsBySkillId = new Map<string, CandidateSkillClaim>();
      for (const c of candidate.skillClaims) {
        claimsBySkillId.set(c.skillId, {
          skillId: c.skillId,
          level: c.level,
          verified: c.status === ClaimStatus.VERIFIED,
        });
      }
      const excluded = new Set([
        ...candidate.applications.map((a) => a.jobId),
        ...(alreadyNotified.get(candidate.userId) ?? []),
      ]);

      const matches = liveJobs
        .filter((job) => !excluded.has(job.id))
        .map((job) => ({ job, result: this.score(job, claimsBySkillId, candidate.yearsOfExp) }))
        .filter(({ result }) => result.score >= MATCH_THRESHOLD)
        .sort((a, b) => b.result.score - a.result.score);

      if (matches.length === 0) continue;

      await this.notifications.sendEmail(
        candidate.userId,
        NotificationType.MATCH_DIGEST,
        `${matches.length} new job match${matches.length === 1 ? '' : 'es'} for you on SkillProof`,
        this.buildDigestHtml(matches),
        matches.map(({ job }) => job.id),
      );
    }
  }

  private score(
    job: DigestJob,
    claimsBySkillId: Map<string, CandidateSkillClaim>,
    yearsOfExp: number | null,
  ) {
    const jobSkills: JobSkillRequirement[] = job.skills.map((s) => ({
      skillId: s.skillId,
      skillName: s.skill.name,
      requiredLevel: s.requiredLevel,
      isRequired: s.isRequired,
    }));
    return scoreCandidate(jobSkills, claimsBySkillId, yearsOfExp, job.experienceMin, job.experienceMax);
  }

  private buildDigestHtml(matches: { job: DigestJob; result: { score: number } }[]): string {
    const items = matches
      .map(
        ({ job, result }) =>
          `<li><strong>${job.title}</strong> at ${job.organization.name} — ${result.score}% match</li>`,
      )
      .join('');
    return `<p>New jobs matching your verified skills:</p><ul>${items}</ul>`;
  }
}
