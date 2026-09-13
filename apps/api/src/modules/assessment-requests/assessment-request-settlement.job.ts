import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssessmentRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssessmentRequestsService } from './assessment-requests.service';

/** Same 14-day window AssessmentRequestsService uses to compute the deadline — duplicated as a query bound here rather than imported, since the service's own constant is module-private and this only needs a loose upper bound anyway (the service re-derives the exact per-row deadline from startedAt and re-checks "all three attempted" before settling — see maybeSettleWholeSkill's own doc comment). Kept comfortably under 14 days so a row is never picked up meaningfully late. */
const SETTLEMENT_LOOKBACK_DAYS = 14;

/**
 * The 14-day settlement backstop for whole-skill AssessmentRequests
 * (2026-09-14, outcome-priced rework) — same shape as
 * AssessmentRequestsExpiryJob (hourly, atomic conditional claim inside the
 * service method it delegates to, per-row failure isolation so one bad row
 * can't abort the sweep). Only ever touches STARTED, level: null rows whose
 * 14-day-from-start deadline has passed; legacy (level != null) rows have
 * no settlement concept at all and are never selected here.
 *
 * This is a backstop, not the primary settlement path — a request whose
 * candidate attempts all three levels settles immediately, the next time
 * either side reads it (see AssessmentRequestsService.reconcile). This job
 * only ever fires for a request that's still incomplete after two full
 * weeks; maybeSettleWholeSkill (which this delegates to) re-checks "all
 * three attempted" first regardless, so a request that happens to complete
 * right at the deadline still settles at the COMPLETE tier, not PARTIAL.
 */
@Injectable()
export class AssessmentRequestSettlementJob {
  private readonly logger = new Logger(AssessmentRequestSettlementJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: AssessmentRequestsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    this.logger.log('Running assessment-request settlement sweep');
    try {
      await this.sweep();
    } catch (err) {
      // Never let one bad iteration take down the whole scheduled job —
      // same "a background job must survive its own failures" contract as
      // AssessmentRequestsExpiryJob.run.
      this.logger.error(`Settlement sweep failed: ${(err as Error).message}`);
    }
  }

  private async sweep(): Promise<void> {
    const deadline = new Date(Date.now() - SETTLEMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const due = await this.prisma.assessmentRequest.findMany({
      where: { level: null, status: AssessmentRequestStatus.STARTED, startedAt: { lte: deadline } },
      select: { id: true, orgId: true, startedAt: true },
    });
    for (const request of due) {
      await this.requests.maybeSettleWholeSkill(request).catch((err) => {
        // A single row's unexpected failure must never abort the rest of the sweep.
        this.logger.error(`Unexpected error settling AssessmentRequest ${request.id}: ${(err as Error).message}`);
      });
    }
  }
}
