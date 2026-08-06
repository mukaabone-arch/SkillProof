import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataExportService } from './data-export.service';

/**
 * Generates data exports asynchronously — see feat/candidate-data-export's
 * PR description for why (the export can be large; a request must never
 * build it inline). Every REQUESTED row is picked up here, never in the
 * request handler itself. Same "a background job must survive its own
 * failures" contract as AssessmentRequestsRefundJob/MatchDigestService:
 * one candidate's export failing to build must never take down the sweep
 * for anyone else's.
 */
@Injectable()
export class DataExportJob {
  private readonly logger = new Logger(DataExportJob.name);

  constructor(private readonly exports: DataExportService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async run(): Promise<void> {
    try {
      await this.generateOne();
    } catch (err) {
      this.logger.error(`Export generation tick failed: ${(err as Error).message}`);
    }
    try {
      const requeued = await this.exports.requeueStalled();
      if (requeued > 0) this.logger.warn(`Requeued ${requeued} stalled export(s) back to REQUESTED`);
    } catch (err) {
      this.logger.error(`Stalled-export requeue failed: ${(err as Error).message}`);
    }
    try {
      await this.exports.expireReady();
    } catch (err) {
      this.logger.error(`Export expiry sweep failed: ${(err as Error).message}`);
    }
  }

  /** One row per tick, not a batch loop — deliberately paced, since this runs every 30s anyway and a single bad row must never let one tick's exception handling swallow every other candidate's request in the same batch. */
  private async generateOne(): Promise<void> {
    const claimed = await this.exports.claimNextRequested();
    if (!claimed) return;

    try {
      await this.exports.completeRequest(claimed.id, claimed.candidateId);
      this.logger.log(`Generated export ${claimed.id}`);
    } catch (err) {
      this.logger.error(`Failed to generate export ${claimed.id}: ${(err as Error).message}`);
      await this.exports.failRequest(claimed.id, (err as Error).message ?? 'Unknown error');
    }
  }
}
