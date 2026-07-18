import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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

    return { jobId: jobId ?? null, jobTitle, kpis, other, total };
  }

  /** Same IDOR check as ShortlistService.getOwnedJob — a jobId from another org can't scope this org's dashboard. */
  private async getOwnedJob(orgId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.orgId !== orgId) throw new ForbiddenException();
    return job;
  }
}
