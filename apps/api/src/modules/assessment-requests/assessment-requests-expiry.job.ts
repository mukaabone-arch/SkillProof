import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssessmentRequestStatus, NotificationType, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TransactionsService } from '../billing/transactions.service';

/**
 * Renamed from AssessmentRequestsRefundJob (2026-09, prepaid -> postpaid
 * switch — file renamed along with the class, unlike the enum/type renames
 * elsewhere in this change, since nothing external references this
 * filename the way a stored enum label would). Under the old prepaid
 * model, this refunded a Razorpay charge back to the employer if the
 * candidate never started it. Postpaid: there is nothing to refund, since
 * nothing is ever collected before an invoice is settled. What used to be
 * "refund the candidate's unused charge back to the employer" is now
 * "exclude this request from ever being invoiced" — every AssessmentRequest
 * that accrues must eventually resolve to either STARTED (candidate used
 * it, billable) or EXPIRED_UNBILLED (they didn't, excluded) — never left
 * hanging in ACCRUED_PENDING_START past its window. This job is what
 * guarantees that: hourly, it excludes every ACCRUED_PENDING_START row
 * whose expiresAt has passed. See excludeOne's own doc comment for the one
 * correctness property that still matters — the start-vs-expiry race (the
 * double-refund guard from the old prepaid version no longer applies:
 * voiding is a pure local status write, not an external payment call, so
 * there is no "the exclusion attempt itself failed" case symmetric to the
 * old REFUND_FAILED retry loop).
 */
@Injectable()
export class AssessmentRequestsExpiryJob {
  private readonly logger = new Logger(AssessmentRequestsExpiryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly transactions: TransactionsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    this.logger.log('Running assessment-request expiry sweep');
    try {
      await this.sweep();
    } catch (err) {
      // Never let one bad iteration take down the whole scheduled job —
      // same "a background job must survive its own failures" contract as
      // MatchDigestService.run.
      this.logger.error(`Expiry sweep failed: ${(err as Error).message}`);
    }
  }

  private async sweep(): Promise<void> {
    const candidates = await this.prisma.assessmentRequest.findMany({
      where: { status: AssessmentRequestStatus.ACCRUED_PENDING_START, expiresAt: { lt: new Date() } },
      select: { id: true },
    });
    for (const { id } of candidates) {
      await this.excludeOne(id, 'EXPIRED').catch((err) => {
        // A single row's unexpected failure must never abort the rest of
        // the sweep.
        this.logger.error(`Unexpected error excluding AssessmentRequest ${id}: ${(err as Error).message}`);
      });
    }
  }

  /**
   * Start-vs-expiry race: an ACCRUED_PENDING_START row is only ever taken
   * off the "candidate can still start this" table by an atomic
   * conditional update — `updateMany WHERE status = ACCRUED_PENDING_START`.
   * This method's only write does exactly that, straight to
   * EXPIRED_UNBILLED, racing AssessmentRequestsService.startFromRequest's
   * own conditional update on the same WHERE clause: whichever commits
   * first wins, and the loser's update simply matches zero rows. That's
   * what guarantees a request can never end up both STARTED and excluded.
   *
   * Voiding the linked Transaction (PENDING -> VOIDED) happens in the same
   * pass — a pure local status write, so unlike the old Razorpay refund
   * call this can't fail independently of the AssessmentRequest update
   * itself; there is no retry-loop status symmetric to the old
   * REFUND_FAILED for that reason. `transactionId` is null only for a row
   * created before this column existed — nothing to void for those,
   * silently skipped rather than erroring on old data.
   *
   * Public and reused as-is (not duplicated) by AccountService when a
   * candidate deactivates or deletes their account — same atomic claim,
   * same race-closing contract, whether this row is being excluded because
   * its 5-day window lapsed or because the candidate just became
   * unavailable. `reason` only changes which copy notifyEmployer sends;
   * every write above it is identical.
   */
  async excludeOne(requestId: string, reason: 'EXPIRED' | 'CANDIDATE_UNAVAILABLE'): Promise<void> {
    const { count } = await this.prisma.assessmentRequest.updateMany({
      where: { id: requestId, status: AssessmentRequestStatus.ACCRUED_PENDING_START },
      data: { status: AssessmentRequestStatus.EXPIRED_UNBILLED },
    });
    if (count === 0) {
      // Either the candidate started it first (lost the race — never
      // exclude a started request), or this row was already excluded by a
      // previous run (idempotent re-entry, e.g. AccountService calling
      // this again for a request the hourly sweep already caught). Either
      // way, nothing left to do.
      return;
    }

    const request = await this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: requestId } });
    await this.voidTransaction(requestId, request.transactionId);
    await this.notifyEmployer(requestId, reason);
  }

  /**
   * Flips the ledger side of an exclusion — TransactionsService.recordSystemVoid
   * (PENDING -> VOIDED) — for the Transaction this request's accrual was
   * originally recorded on. `transactionId` is null for any row created
   * before this column existed — nothing to void for those, silently
   * skipped rather than erroring on old data. Best-effort: the
   * AssessmentRequest side has already committed to EXPIRED_UNBILLED by
   * the time this runs — a failure here is a ledger bookkeeping gap to
   * fix (the transaction stays PENDING and would otherwise be picked up
   * by the monthly invoicing job, incorrectly billing an excluded
   * request), logged loudly rather than silently accepted.
   */
  private async voidTransaction(requestId: string, transactionId: string | null): Promise<void> {
    if (!transactionId) return;
    try {
      const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId }, select: { status: true } });
      if (transaction?.status === TransactionStatus.PENDING) {
        await this.transactions.recordSystemVoid(transactionId);
      }
    } catch (err) {
      this.logger.error(
        `Failed to void Transaction ${transactionId} for excluded AssessmentRequest ${requestId} — it will otherwise be picked up by the next invoicing run: ${(err as Error).message}`,
      );
    }
  }

  private async notifyEmployer(requestId: string, reason: 'EXPIRED' | 'CANDIDATE_UNAVAILABLE'): Promise<void> {
    try {
      const request = await this.prisma.assessmentRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { skill: true, candidateProfile: true },
      });

      // CANDIDATE_UNAVAILABLE deliberately never names the candidate, even
      // when the profile hasn't been anonymized (a deactivation, unlike a
      // deletion, leaves fullName intact) — matching the privacy posture
      // AccountService.makeCandidateUnavailableToEmployers already commits
      // to for its own PIPELINE_CANDIDATE_UNAVAILABLE notification just
      // above this same call site ("Deliberately never includes the
      // candidate's stated reason... 'No longer available' is true and
      // complete without it"). The EXPIRED case is unrelated to that
      // policy — the candidate never became unavailable, they're simply
      // slow — so it keeps using fullName exactly as before.
      //
      // request.level is null for a whole-skill request (2026-09-14 rework)
      // — describe the skill alone rather than interpolating a level that
      // doesn't apply to the request as a whole.
      const assessmentLabel = request.level ? `${request.skill.name} ${request.level}` : `${request.skill.name}`;
      const { subject, body } =
        reason === 'EXPIRED'
          ? {
              subject: `Assessment request expired unused — ${request.candidateProfile.fullName ?? 'candidate'}`,
              body:
                `<p>Your request for <strong>${request.candidateProfile.fullName ?? 'the candidate'}</strong> to take the ` +
                `${assessmentLabel} assessment expired after 5 days — they never started it.</p>` +
                `<p>It will not appear on your invoice.</p>`,
            }
          : {
              subject: `Assessment request excluded — candidate no longer available`,
              body:
                `<p>The candidate you requested a ${assessmentLabel} assessment for is no longer ` +
                `available on MyAmbii, and never started it.</p>` +
                `<p>It will not appear on your invoice.</p>`,
            };

      await this.notifications.sendEmail(request.requestedByUserId, NotificationType.ASSESSMENT_REQUEST_EXPIRED, subject, body);
    } catch {
      // Best-effort — same contract as every other NotificationsService caller.
    }
  }
}
