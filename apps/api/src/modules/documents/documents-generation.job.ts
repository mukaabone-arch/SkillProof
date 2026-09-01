import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DocumentsService } from './documents.service';

/**
 * The queue for GST document generation, in-process — no message broker
 * exists in this codebase (checked before building this: no BullMQ wiring
 * anywhere despite the tech-spec mentioning it aspirationally), so this
 * reuses the exact pattern AssessmentRequestsRefundJob already established:
 * an hourly sweep over DB state rather than an explicit enqueue. A
 * Transaction with no Document IS the queue (see
 * DocumentsService.findTransactionsNeedingDocuments) — nothing else needs
 * to remember "this charge needs a document," the absence of a Document row
 * is that fact.
 *
 * Two phases per run, deliberately in this order and never interleaved per
 * document — see Document's own doc comment for why numbering and
 * rendering are split at all:
 *  1. Reserve + create a Document (numbered) for every eligible Transaction
 *     that doesn't have one yet — this is also the entire backfill
 *     mechanism (see docs/legal/refund-policy-content.md-adjacent design
 *     notes): the first sweep after this ships has a longer list to work
 *     through, same code path as ordinary traffic from then on.
 *  2. Render + store every PENDING document (numbered, no file yet, or a
 *     previous render attempt failed) up to MAX_GENERATION_ATTEMPTS —
 *     retried independently of step 1, against an already-numbered row.
 *
 * A failure in either phase for one row is logged and never stops the rest
 * of the sweep or the other phase — same "a background job must survive
 * its own failures" contract as every other @Cron job in this codebase
 * (AssessmentRequestsRefundJob, MatchDigestService).
 */
@Injectable()
export class DocumentsGenerationJob {
  private readonly logger = new Logger(DocumentsGenerationJob.name);

  constructor(private readonly documents: DocumentsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    this.logger.log('Running GST document generation sweep');
    await this.reservePhase();
    await this.renderPhase();
  }

  private async reservePhase(): Promise<void> {
    const pending = await this.documents.findTransactionsNeedingDocuments();
    for (const { id } of pending) {
      try {
        await this.documents.reserveAndCreate(id);
      } catch (err) {
        // Never silently dropped: this Transaction still has no Document
        // and will be picked up again on the next sweep tick, since the
        // query that found it (Transaction.document == null) is unchanged
        // by a failed attempt.
        this.logger.error(`reserveAndCreate failed for Transaction ${id}: ${(err as Error).message}`);
      }
    }
  }

  private async renderPhase(): Promise<void> {
    const pending = await this.documents.findPendingForRender();
    for (const { id } of pending) {
      // renderAndStore handles its own failure bookkeeping (attempt count,
      // lastGenerationError, the FAILED_NEEDS_ATTENTION escalation) — it
      // never throws for an ordinary render/upload failure, only for a
      // truly unexpected one, which this catch still contains.
      await this.documents.renderAndStore(id).catch((err) => {
        this.logger.error(`Unexpected error in renderAndStore for Document ${id}: ${(err as Error).message}`);
      });
    }
  }
}
