import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DocumentsService } from '../documents/documents.service';

/**
 * Monthly aggregation for the postpaid assessment-request model (2026-09 —
 * replaces the old prepaid-and-refund flow entirely). Each accrued,
 * billable AssessmentRequest already has its own ASSESSMENT_REQUEST_ACCRUAL
 * Transaction, written at creation (see AssessmentRequestsService.create);
 * this job's only job is to find every org with at least one such
 * transaction still PENDING and uninvoiced, and turn them into one GST
 * TAX_INVOICE per org covering every one of them — see DocumentsService.
 * findOrgsWithAccrualsNeedingInvoice/reserveAndCreateForOrgPeriod for the
 * actual eligibility query and aggregation.
 *
 * Deliberately monthly cadence, not hourly like DocumentsGenerationJob or
 * the old refund job — there's no urgency to invoicing (nothing is
 * time-sensitive the way a 5-day candidate-start window is), and batching
 * a whole month's accruals into one invoice is the entire point. Running
 * more or less often than monthly would still be *correct* (the
 * eligibility query has no calendar-month filter — see its own doc
 * comment), just not what "monthly" means to the business.
 *
 * Reuses reserveAndCreate's own PDF-rendering path unchanged: this job
 * only numbers and creates the Document (identical two-phase split as
 * every other GST document — see that model's own doc comment);
 * DocumentsGenerationJob's existing hourly renderPhase picks up the new
 * PENDING Document exactly as it already does for subscription charges,
 * with no changes needed there.
 */
@Injectable()
export class AssessmentRequestInvoicingJob {
  private readonly logger = new Logger(AssessmentRequestInvoicingJob.name);

  constructor(private readonly documents: DocumentsService) {}

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_NOON)
  async run(): Promise<void> {
    this.logger.log('Running assessment-request monthly invoicing sweep');
    try {
      await this.sweep();
    } catch (err) {
      // Never let one bad iteration take down the whole scheduled job —
      // same "a background job must survive its own failures" contract as
      // every other @Cron job in this codebase.
      this.logger.error(`Invoicing sweep failed: ${(err as Error).message}`);
    }
  }

  private async sweep(): Promise<void> {
    const orgs = await this.documents.findOrgsWithAccrualsNeedingInvoice();
    for (const { billingProfileId } of orgs) {
      try {
        await this.documents.reserveAndCreateForOrgPeriod(billingProfileId);
      } catch (err) {
        // Never silently dropped: this org's accruals still have no
        // Document and will be picked up again on the next sweep, since
        // the query that found them (documentId == null) is unchanged by
        // a failed attempt.
        this.logger.error(`reserveAndCreateForOrgPeriod failed for BillingProfile ${billingProfileId}: ${(err as Error).message}`);
      }
    }
  }
}
