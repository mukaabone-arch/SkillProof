import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';

/** How many rows each recent-activity list shows — matches no particular
 * spec value, just a sane "at a glance" preview size for a dashboard card. */
const RECENT_LIMIT = 5;

/** Left-to-right funnel order — the five cards the dashboard renders. */
const KPI_STAGES = [
  ShortlistStage.SHORTLISTED,
  ShortlistStage.INVITED,
  ShortlistStage.INTERVIEWING,
  ShortlistStage.OFFER,
  ShortlistStage.HIRED,
] as const;

/** Terminal stages that aren't a KPI card but still count toward the reconcilable total. */
const OTHER_STAGES = [ShortlistStage.DECLINED, ShortlistStage.REJECTED, ShortlistStage.CLOSED] as const;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  async summary(orgId: string, jobId?: string) {
    let jobTitle: string | null = null;
    if (jobId) {
      const job = await this.getOwnedJob(orgId, jobId);
      jobTitle = job.title;
    }

    // One query for every stage count — grouped, not five separate `count()` calls.
    const grouped = await this.prisma.shortlistEntry.groupBy({
      by: ['stage'],
      where: { orgId, ...(jobId ? { jobId } : {}) },
      _count: { _all: true },
    });

    const countByStage = new Map(grouped.map((g) => [g.stage, g._count._all]));
    const count = (stage: ShortlistStage) => countByStage.get(stage) ?? 0;

    const kpis = {
      shortlisted: count(ShortlistStage.SHORTLISTED),
      interviewPending: count(ShortlistStage.INVITED),
      interviewing: count(ShortlistStage.INTERVIEWING),
      offersOut: count(ShortlistStage.OFFER),
      hired: count(ShortlistStage.HIRED),
    };
    const other = {
      declined: count(ShortlistStage.DECLINED),
      rejected: count(ShortlistStage.REJECTED),
      closed: count(ShortlistStage.CLOSED),
    };
    const total = [...KPI_STAGES, ...OTHER_STAGES].reduce((sum, stage) => sum + count(stage), 0);

    // Top-level org overview — deliberately NOT filtered by jobId (unlike
    // kpis/other/total above): these four describe the org's overall
    // standing, not one role's funnel, so the existing Role dropdown filter
    // on this page never touches them.
    const overview = await this.orgOverview(orgId);
    const setup = await this.setupChecklist(orgId);

    return { orgId, jobId: jobId ?? null, jobTitle, kpis, other, total, ...overview, setup };
  }

  /**
   * The dashboard's "Set up your organisation" card. Derived on read, not a
   * stored flag — un-ticking an item when its underlying data is later
   * removed (e.g. the logo is deleted) is the correct behavior, not drift
   * to guard against. "Organisation created"/"Admin account" aren't items
   * here at all: AuthService.signup creates User + Organization + OrgMember
   * in one transaction, so both are true for every org that can reach this
   * endpoint — showing them would be permanently-ticked padding, not signal.
   */
  private async setupChecklist(orgId: string) {
    const [org, memberCount, invitationCount] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { industry: true, website: true, logoKey: true } }),
      this.prisma.orgMember.count({ where: { organizationId: orgId } }),
      // Any invitation ever sent counts, regardless of status — a revoked
      // or expired one still proves the admin took the action once, which
      // is all this item is checking for.
      this.prisma.orgInvitation.count({ where: { organizationId: orgId } }),
    ]);

    const items = {
      invitedTeam: memberCount > 1 || invitationCount > 0,
      logo: org.logoKey != null,
      companyInfo: !!org.industry && !!org.website,
    };
    const doneCount = Object.values(items).filter(Boolean).length;
    const total = Object.keys(items).length;

    return { items, doneCount, total, allDone: doneCount === total };
  }

  /**
   * The dashboard home's four top KPI cards plus recent-activity previews.
   * activeJobs/totalApplicants/applicantsThisMonth are all real, direct
   * counts. avgTimeToHireDays is the one honest exception: computed from
   * ShortlistEntry.createdAt -> updatedAt for HIRED entries when any exist,
   * but ShortlistEntry has no dedicated per-stage-transition timestamp, so
   * updatedAt is only a proxy for "became HIRED" (any later write to the
   * row — a note edit, a round added — would also bump it, though in
   * practice HIRED is terminal and rarely touched again). Never fabricated
   * or hardcoded: with zero HIRED entries (true for every org in dev today
   * — checked directly) this is null, and the client shows an honest
   * "not enough data yet" rather than a number.
   */
  private async orgOverview(orgId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [activeJobs, totalApplicants, applicantsThisMonth, hiredEntries, recentJobsRaw, recentApplicants] = await Promise.all([
      this.prisma.job.count({ where: { orgId, status: JobStatus.LIVE } }),
      this.prisma.application.count({ where: { job: { orgId } } }),
      this.prisma.application.count({ where: { job: { orgId }, createdAt: { gte: startOfMonth } } }),
      this.prisma.shortlistEntry.findMany({
        where: { orgId, stage: ShortlistStage.HIRED },
        select: { createdAt: true, updatedAt: true },
      }),
      this.prisma.job.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        include: { _count: { select: { applications: true } } },
      }),
      this.jobs.getApplicantsForOrg(orgId, RECENT_LIMIT),
    ]);

    const avgTimeToHireDays =
      hiredEntries.length > 0
        ? Math.round(
            hiredEntries.reduce((sum, e) => sum + (e.updatedAt.getTime() - e.createdAt.getTime()), 0) /
              hiredEntries.length /
              (1000 * 60 * 60 * 24),
          )
        : null;

    const recentJobs = recentJobsRaw.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      applicantCount: j._count.applications,
      createdAt: j.createdAt,
    }));

    return { activeJobs, totalApplicants, applicantsThisMonth, avgTimeToHireDays, recentJobs, recentApplicants };
  }

  /** Same IDOR check as ShortlistService.getOwnedJob — a jobId from another org can't scope this org's dashboard. */
  private async getOwnedJob(orgId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.orgId !== orgId) throw new ForbiddenException();
    return job;
  }
}
