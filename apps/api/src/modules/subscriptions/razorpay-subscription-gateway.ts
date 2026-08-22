import { Injectable } from '@nestjs/common';
import Razorpay from 'razorpay';

/**
 * The subscription-side counterpart to
 * assessment-requests/razorpay-gateway.ts's RazorpayGateway — same
 * "thin seam over only the SDK surface its own caller uses, not a general
 * wrapper" philosophy, and same interface + DI token shape so tests can
 * swap in a fake. Kept as its own file/interface rather than folded into
 * the existing RazorpayGateway: that one is order-flow-scoped
 * (createOrder/fetchOrder/refundPayment) for AssessmentRequestsService's
 * one-time payments, and this one is subscription-lifecycle-scoped
 * (create/fetch/update/cancel) for SubscriptionsService — different
 * callers, different Razorpay API surface, no shared code between them
 * beyond "wrap a slice of the same SDK instance."
 */
export interface RazorpaySubscriptionSnapshot {
  id: string;
  status: string;
  planId: string;
  currentStart: number | null;
  currentEnd: number | null;
  notes: Record<string, string> | null;
}

export interface RazorpaySubscriptionGateway {
  createSubscription(params: { planId: string; totalCount: number; notes: Record<string, string> }): Promise<RazorpaySubscriptionSnapshot>;
  fetchSubscription(subscriptionId: string): Promise<RazorpaySubscriptionSnapshot>;
  /** schedule_change_at is always 'cycle_end' from this codebase's own caller (see SubscriptionsService.switchPlan) — no surprise mid-cycle charge/refund. */
  updateSubscriptionPlan(subscriptionId: string, planId: string, scheduleChangeAt: 'now' | 'cycle_end'): Promise<RazorpaySubscriptionSnapshot>;
  cancelSubscription(subscriptionId: string, cancelAtCycleEnd: boolean): Promise<RazorpaySubscriptionSnapshot>;
}

export const RAZORPAY_SUBSCRIPTION_GATEWAY = Symbol('RAZORPAY_SUBSCRIPTION_GATEWAY');

function toSnapshot(sub: {
  id: string;
  status: string;
  plan_id: string;
  current_start?: number | null;
  current_end?: number | null;
  notes?: unknown;
}): RazorpaySubscriptionSnapshot {
  return {
    id: sub.id,
    status: sub.status,
    planId: sub.plan_id,
    currentStart: sub.current_start ?? null,
    currentEnd: sub.current_end ?? null,
    notes: (sub.notes as unknown as Record<string, string> | null) ?? null,
  };
}

@Injectable()
export class RazorpaySdkSubscriptionGateway implements RazorpaySubscriptionGateway {
  private readonly client: Razorpay;

  constructor() {
    this.client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  async createSubscription(params: { planId: string; totalCount: number; notes: Record<string, string> }): Promise<RazorpaySubscriptionSnapshot> {
    const sub = await this.client.subscriptions.create({
      plan_id: params.planId,
      total_count: params.totalCount,
      customer_notify: 1,
      notes: params.notes,
    });
    return toSnapshot(sub);
  }

  async fetchSubscription(subscriptionId: string): Promise<RazorpaySubscriptionSnapshot> {
    const sub = await this.client.subscriptions.fetch(subscriptionId);
    return toSnapshot(sub);
  }

  async updateSubscriptionPlan(
    subscriptionId: string,
    planId: string,
    scheduleChangeAt: 'now' | 'cycle_end',
  ): Promise<RazorpaySubscriptionSnapshot> {
    const sub = await this.client.subscriptions.update(subscriptionId, { plan_id: planId, schedule_change_at: scheduleChangeAt });
    return toSnapshot(sub);
  }

  async cancelSubscription(subscriptionId: string, cancelAtCycleEnd: boolean): Promise<RazorpaySubscriptionSnapshot> {
    const sub = await this.client.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
    return toSnapshot(sub);
  }
}
