import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RAZORPAY_SUBSCRIPTION_GATEWAY, RazorpaySubscriptionGateway } from './razorpay-subscription-gateway';
import { BillingInterval } from './subscriptions.dto';

/**
 * Razorpay requires a finite total_count on every subscription — there is
 * no "bill until cancelled" option. 100 cycles is a deliberately large,
 * arbitrary bound (~8 years monthly, ~100 years annual) chosen so
 * subscription.completed (all cycles exhausted) is a non-event in
 * practice, handled defensively by the webhook but never expected to
 * actually fire.
 */
const TOTAL_COUNT = 100;

function resolvePlanId(plan: BillingInterval): string {
  const planId = plan === 'MONTHLY' ? process.env.RAZORPAY_PLAN_ID_MONTHLY : process.env.RAZORPAY_PLAN_ID_ANNUAL;
  if (!planId) {
    throw new BadRequestException(
      `Razorpay is not configured — set RAZORPAY_PLAN_ID_${plan === 'MONTHLY' ? 'MONTHLY' : 'ANNUAL'}.`,
    );
  }
  return planId;
}

/**
 * The razorpay SDK rejects with a plain `{ statusCode, error: { description,
 * ... } }` object, not a real Error (confirmed against the real test API —
 * see this module's own test-mode verification notes) — an uncaught
 * rejection like that reaches Nest's exception filter as an opaque 500
 * ("Internal server error"), discarding Razorpay's own, often actionable,
 * description (e.g. "Subscription cannot be cancelled since no billing
 * cycle is going on"). Every Razorpay call this service makes on a
 * candidate's behalf goes through this so a real provider-side rejection
 * surfaces as a clear 400 instead.
 */
function translateRazorpayError(err: unknown): never {
  const description = (err as { error?: { description?: string } } | undefined)?.error?.description;
  if (description) throw new BadRequestException(description);
  throw err;
}

/**
 * Candidate-facing checkout/cancel/plan-switch/status. Never writes
 * Subscription.tier/status/currentPeriodStart/End itself — those only ever
 * come from RazorpayWebhookService (verified webhooks) per this feature's
 * own constraint. The two fields this service *does* write directly
 * (cancelAtPeriodEnd here, and status only in the immediate-cancel-on-
 * deletion path below) are both the direct, synchronous response of a
 * Razorpay API call this service itself just made — not a client-supplied
 * status — which is the boundary that constraint actually draws.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RAZORPAY_SUBSCRIPTION_GATEWAY) private readonly razorpay: RazorpaySubscriptionGateway,
  ) {}

  /**
   * Step 1 of checkout — creates the Razorpay subscription and hands back
   * just enough for the frontend to open Checkout (subscription_id + the
   * publishable key id). No amount/currency here: those live on the Plan
   * in the Razorpay dashboard, never asserted client-side. candidateId is
   * pinned into the subscription's own `notes` (same pattern
   * AssessmentRequestsService.initiate already uses for orders) — that's
   * what lets RazorpayWebhookService attribute the eventual
   * subscription.activated/charged event to this candidate without
   * trusting anything the client resubmits.
   */
  async initiateCheckout(userId: string, plan: BillingInterval): Promise<{ subscriptionId: string; keyId: string }> {
    const candidateId = await this.ensureProfileId(userId);
    const planId = resolvePlanId(plan);
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId || !process.env.RAZORPAY_KEY_SECRET) {
      throw new BadRequestException('Razorpay is not configured — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET.');
    }

    try {
      const sub = await this.razorpay.createSubscription({
        planId,
        totalCount: TOTAL_COUNT,
        notes: { candidateId },
      });
      return { subscriptionId: sub.id, keyId };
    } catch (err) {
      translateRazorpayError(err);
    }
  }

  /**
   * GET-style read for the candidate's own current subscription — the
   * account/upgrade page's data source for rendering "Cancel", "Switch to
   * Annual", etc. `interval` is derived by comparing providerPlanId
   * against the two configured Razorpay plan ids rather than stored
   * separately — see Subscription.providerPlanId's own doc comment.
   */
  async getMine(userId: string) {
    const candidateId = await this.ensureProfileId(userId);
    const subscription = await this.prisma.subscription.findUnique({ where: { candidateId } });

    const interval: BillingInterval | null =
      subscription?.providerPlanId && subscription.providerPlanId === process.env.RAZORPAY_PLAN_ID_MONTHLY
        ? 'MONTHLY'
        : subscription?.providerPlanId && subscription.providerPlanId === process.env.RAZORPAY_PLAN_ID_ANNUAL
          ? 'ANNUAL'
          : null;

    return {
      tier: subscription?.tier ?? 'FREE',
      status: subscription?.status ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      interval,
    };
  }

  /**
   * Cancel-at-period-end — the only cancellation mode this product offers
   * (see the design's own note on deferring "un-cancel"). The Razorpay
   * call is synchronous and its own response is what's trusted here, not
   * a client-supplied status; cancelAtPeriodEnd is written immediately off
   * that response so the UI reflects the decision right away, while
   * tier/status stay untouched — the candidate keeps Premium exactly as
   * before until subscription.cancelled eventually confirms the period
   * really ended.
   */
  async cancel(userId: string): Promise<{ cancelAtPeriodEnd: true }> {
    const candidateId = await this.ensureProfileId(userId);
    const subscription = await this.prisma.subscription.findUnique({ where: { candidateId } });
    if (!subscription?.providerSubId) {
      throw new BadRequestException('No active subscription to cancel.');
    }

    try {
      await this.razorpay.cancelSubscription(subscription.providerSubId, true);
    } catch (err) {
      translateRazorpayError(err);
    }
    await this.prisma.subscription.update({ where: { candidateId }, data: { cancelAtPeriodEnd: true } });
    return { cancelAtPeriodEnd: true };
  }

  /**
   * Monthly <-> annual, always deferred to cycle_end per the approved
   * design — no surprise prorated charge. Nothing is written to our own
   * Subscription row here: schedule_change_at: 'cycle_end' means nothing
   * actually changes until the current period ends, at which point
   * subscription.updated (or the next subscription.charged) is what
   * confirms the new plan_id/period and is the only thing that updates
   * providerPlanId.
   */
  async switchPlan(userId: string, plan: BillingInterval): Promise<{ scheduled: true }> {
    const candidateId = await this.ensureProfileId(userId);
    const subscription = await this.prisma.subscription.findUnique({ where: { candidateId } });
    if (!subscription?.providerSubId) {
      throw new BadRequestException('No active subscription to switch.');
    }

    const planId = resolvePlanId(plan);
    try {
      await this.razorpay.updateSubscriptionPlan(subscription.providerSubId, planId, 'cycle_end');
    } catch (err) {
      translateRazorpayError(err);
    }
    return { scheduled: true };
  }

  /**
   * Called by AccountService.delete — cancel immediately (not at period
   * end), confirmed: continuing to bill a permanently anonymised identity
   * has no defence. Best-effort by design, same as every other external
   * call inside AccountService.delete (e.g. deleteStoredFiles) — a
   * Razorpay outage must never block a candidate's right to erasure.
   * status is written directly off cancelSubscription's own synchronous
   * response for the same reason cancel() writes cancelAtPeriodEnd
   * directly — this is a verified provider API result, not a
   * client-supplied one.
   */
  async cancelImmediatelyForDeletion(candidateId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({ where: { candidateId } });
    if (!subscription?.providerSubId) return;
    if (subscription.status === SubscriptionStatus.CANCELED || subscription.status === SubscriptionStatus.EXPIRED) return;

    try {
      await this.razorpay.cancelSubscription(subscription.providerSubId, false);
      await this.prisma.subscription.update({
        where: { candidateId },
        data: { status: SubscriptionStatus.CANCELED, cancelAtPeriodEnd: false },
      });
    } catch (err) {
      const description = (err as { error?: { description?: string } } | undefined)?.error?.description ?? (err as Error)?.message ?? 'unknown error';
      this.logger.error(`Failed to cancel Razorpay subscription ${subscription.providerSubId} during account deletion: ${description}`);
    }
  }

  /** Same ensureProfile-on-first-use pattern used throughout this codebase (e.g. EntitlementsService, CertificationsService). */
  private async ensureProfileId(userId: string): Promise<string> {
    const existing = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.candidateProfile.create({ data: { userId }, select: { id: true } });
    return created.id;
  }
}
