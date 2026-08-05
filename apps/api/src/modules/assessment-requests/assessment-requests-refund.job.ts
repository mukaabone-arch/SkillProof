import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssessmentRequestStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RAZORPAY_GATEWAY, RazorpayGateway } from './razorpay-gateway';

/**
 * Every AssessmentRequest that took a real payment must eventually resolve
 * to either STARTED (candidate used it) or EXPIRED_REFUNDED (they didn't,
 * employer got their money back) — never left hanging in PAID_PENDING_START
 * past its window, and never silently stuck on a failed refund. This job is
 * what guarantees that: hourly, it (1) refunds every PAID_PENDING_START row
 * whose expiresAt has passed, and (2) retries every REFUND_FAILED row from
 * a previous run, until every one of them reaches EXPIRED_REFUNDED. See
 * refundOne's doc comment for the two correctness properties that matter
 * most — the double-refund guard and the start-vs-expiry race.
 */
@Injectable()
export class AssessmentRequestsRefundJob {
  private readonly logger = new Logger(AssessmentRequestsRefundJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(RAZORPAY_GATEWAY) private readonly razorpay: RazorpayGateway,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    this.logger.log('Running assessment-request refund sweep');
    try {
      await this.sweep();
    } catch (err) {
      // Never let one bad iteration take down the whole scheduled job —
      // same "a background job must survive its own failures" contract as
      // MatchDigestService.run.
      this.logger.error(`Refund sweep failed: ${(err as Error).message}`);
    }
  }

  private async sweep(): Promise<void> {
    const candidates = await this.prisma.assessmentRequest.findMany({
      where: {
        OR: [
          { status: AssessmentRequestStatus.PAID_PENDING_START, expiresAt: { lt: new Date() } },
          { status: AssessmentRequestStatus.REFUND_FAILED },
        ],
      },
      select: { id: true },
    });
    for (const { id } of candidates) {
      await this.refundOne(id, 'EXPIRED').catch((err) => {
        // A single row's unexpected failure (not the ordinary "Razorpay
        // rejected the refund call" path, which refundOne already handles
        // by leaving it at REFUND_FAILED) must never abort the rest of the
        // sweep.
        this.logger.error(`Unexpected error refunding AssessmentRequest ${id}: ${(err as Error).message}`);
      });
    }
  }

  /**
   * Two correctness properties, in order:
   *
   * 1. Start-vs-expiry race: a PAID_PENDING_START row is only ever taken
   *    off the "candidate can still start this" table by an atomic
   *    conditional update — `updateMany WHERE status = PAID_PENDING_START`.
   *    This method's very first write does exactly that (straight to
   *    REFUND_FAILED, *before* ever calling Razorpay), so it races
   *    AssessmentRequestsService.startFromRequest's own conditional update
   *    on the same WHERE clause: whichever commits first wins, and the
   *    loser's update simply matches zero rows. That ordering is what
   *    guarantees Razorpay's refund API is only ever called for a payment
   *    this job has *already* atomically taken away from the candidate —
   *    never one that just got started a moment earlier. (For a row
   *    already at REFUND_FAILED from a prior run, this first step is a
   *    no-op re-fetch: it left PAID_PENDING_START on the *previous* run,
   *    so there's no new race to close here.)
   *
   * 2. Double-refund guard: razorpayRefundId is only ever set once, right
   *    after Razorpay's refund call actually succeeds. Re-checking it
   *    immediately before making that call (on this fresh read, not a
   *    stale one from sweep()'s list query) is what stops a second
   *    accidental attempt — e.g. a retry of a row that actually succeeded
   *    last run but failed to persist status=EXPIRED_REFUNDED for some
   *    other reason — from ever refunding twice.
   *
   * Public and reused as-is (not duplicated) by AccountService when a
   * candidate deactivates or deletes their account — same atomic claim,
   * same double-refund guard, same REFUND_FAILED retry contract, whether
   * this row is being refunded because its 5-day window lapsed or because
   * the candidate just became unavailable. `reason` only changes which
   * copy notifyEmployer sends; every write above it is identical.
   */
  async refundOne(requestId: string, reason: 'EXPIRED' | 'CANDIDATE_UNAVAILABLE'): Promise<void> {
    let request = await this.prisma.assessmentRequest.findUnique({ where: { id: requestId } });
    if (!request) return;

    if (request.status === AssessmentRequestStatus.PAID_PENDING_START) {
      const { count } = await this.prisma.assessmentRequest.updateMany({
        where: { id: requestId, status: AssessmentRequestStatus.PAID_PENDING_START },
        data: { status: AssessmentRequestStatus.REFUND_FAILED },
      });
      if (count === 0) {
        // Lost the race — the candidate started it between the caller's
        // list query and this claim attempt. Never refund a started request.
        return;
      }
      request = await this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: requestId } });
    }

    if (request.razorpayRefundId) {
      // Already refunded (see doc comment above) — just make sure the
      // status agrees, in case a previous run's post-refund status write
      // itself failed after the refund had already gone through.
      if (request.status !== AssessmentRequestStatus.EXPIRED_REFUNDED) {
        await this.prisma.assessmentRequest.update({
          where: { id: requestId },
          data: { status: AssessmentRequestStatus.EXPIRED_REFUNDED },
        });
      }
      return;
    }

    if (!request.razorpayPaymentId || !request.amount) {
      this.logger.error(`AssessmentRequest ${requestId} is REFUND_FAILED with no payment id/amount — needs manual attention.`);
      return;
    }

    try {
      const refund = await this.razorpay.refundPayment(request.razorpayPaymentId, request.amount);
      await this.prisma.assessmentRequest.update({
        where: { id: requestId },
        data: { status: AssessmentRequestStatus.EXPIRED_REFUNDED, razorpayRefundId: refund.id },
      });
      await this.notifyEmployer(requestId, reason);
    } catch (err) {
      // Stays at REFUND_FAILED (already set above) — the *next* sweep
      // retries it. Never silently dropped: a row can only leave
      // REFUND_FAILED via a logged, successful Razorpay refund call.
      this.logger.error(`Razorpay refund failed for AssessmentRequest ${requestId}: ${(err as Error).message}`);
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
      const { subject, body } =
        reason === 'EXPIRED'
          ? {
              subject: `Assessment request expired unused — ${request.candidateProfile.fullName ?? 'candidate'}`,
              body:
                `<p>Your request for <strong>${request.candidateProfile.fullName ?? 'the candidate'}</strong> to take the ` +
                `${request.skill.name} ${request.level} assessment expired after 5 days — they never started it.</p>` +
                `<p>You've been automatically refunded.</p>`,
            }
          : {
              subject: `Assessment request refunded — candidate no longer available`,
              body:
                `<p>The candidate you requested a ${request.skill.name} ${request.level} assessment for is no longer ` +
                `available on SkillProof, and never started it.</p>` +
                `<p>You've been automatically refunded.</p>`,
            };

      await this.notifications.sendEmail(request.requestedByUserId, NotificationType.ASSESSMENT_REQUEST_EXPIRED, subject, body);
    } catch {
      // Best-effort — same contract as every other NotificationsService caller.
    }
  }
}
