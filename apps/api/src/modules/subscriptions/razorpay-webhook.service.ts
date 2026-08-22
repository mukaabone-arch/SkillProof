import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionStatus, SubscriptionTier, TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionsService } from '../billing/transactions.service';
import { SubscriptionBillingProfileService } from './subscription-billing-profile.service';

/**
 * Razorpay's own subscription-entity status values that map cleanly onto
 * our SubscriptionStatus — 'created'/'authenticated' (pre-activation,
 * no row exists yet) and 'expired' (pre-activation abandonment) are
 * deliberately absent: those event types are filtered out before this map
 * is ever consulted (see handle()'s eventType switch) rather than given an
 * entry here, since there is nothing in our schema they should ever write.
 */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: SubscriptionStatus.ACTIVE,
  pending: SubscriptionStatus.PAST_DUE,
  halted: SubscriptionStatus.PAST_DUE,
  cancelled: SubscriptionStatus.CANCELED,
  completed: SubscriptionStatus.EXPIRED,
};

interface RazorpaySubscriptionEntity {
  id: string;
  status: string;
  plan_id: string;
  current_start?: number | null;
  current_end?: number | null;
  notes?: Record<string, string> | null;
}

interface RazorpayPaymentEntity {
  id: string;
  amount: number;
  currency: string;
}

interface RazorpayWebhookPayload {
  event: string;
  created_at: number;
  payload: {
    subscription?: { entity: RazorpaySubscriptionEntity };
    payment?: { entity: RazorpayPaymentEntity };
  };
}

/** Event types that only ever occur before a subscription has ever been charged — no Subscription row should exist yet, so there is nothing to apply. */
const PRE_ACTIVATION_EVENTS = new Set(['subscription.authenticated', 'subscription.expired']);

/** Every event type this handler acts on — anything else (payment.*, refund.*, order.*, ...) is accepted (200) but intentionally ignored; see this module's design notes on why subscription.charged's own embedded payment entity is used instead of separately subscribing to payment.captured. */
const SUBSCRIPTION_SNAPSHOT_EVENTS = new Set([
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.completed',
]);

@Injectable()
export class RazorpayWebhookService {
  private readonly logger = new Logger(RazorpayWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly billingProfiles: SubscriptionBillingProfileService,
  ) {}

  /**
   * HMAC-SHA256 over the raw (unparsed) body, RAZORPAY_WEBHOOK_SECRET as
   * key, timingSafeEqual comparison — matching
   * AssessmentRequestsService.verifyAndCreate's own manual HMAC check
   * rather than the razorpay SDK's own validateWebhookSignature, which
   * compares with a plain `===` (confirmed by reading
   * node_modules/razorpay/dist/utils/razorpay-utils.js) — not
   * constant-time, and this codebase already has an established
   * constant-time pattern to match instead. rawBody must be the untouched
   * Express body buffer (see main.ts's rawBody: true) — Razorpay's own
   * docs are explicit that re-serializing/re-parsing the body before
   * verifying breaks the signature.
   */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signatureHeader) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    let expectedBuf: Buffer;
    let actualBuf: Buffer;
    try {
      expectedBuf = Buffer.from(expected, 'hex');
      actualBuf = Buffer.from(signatureHeader, 'hex');
    } catch {
      return false;
    }
    return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
  }

  /**
   * Idempotency + ordering entry point — see RazorpayWebhookEvent's own
   * schema doc comment for the full contract this implements. Caller
   * (RazorpayWebhookController) has already verified the signature before
   * this is ever reached; eventId is the x-razorpay-event-id header value.
   */
  async handle(eventId: string, payload: RazorpayWebhookPayload): Promise<void> {
    let ledgerRow = await this.prisma.razorpayWebhookEvent.findUnique({ where: { id: eventId } });
    if (ledgerRow?.processedAt) {
      // True duplicate delivery of an event already fully applied — Razorpay
      // explicitly documents this as expected behaviour, not an error.
      return;
    }

    if (!ledgerRow) {
      const entity = payload.payload.subscription?.entity;
      ledgerRow = await this.prisma.razorpayWebhookEvent.create({
        data: { id: eventId, eventType: payload.event, providerSubId: entity?.id ?? null, payload: payload as unknown as object },
      });
    }

    const applied = await this.apply(payload);

    await this.prisma.razorpayWebhookEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date(), applied },
    });
  }

  private async apply(payload: RazorpayWebhookPayload): Promise<boolean> {
    if (PRE_ACTIVATION_EVENTS.has(payload.event)) return false;
    if (!SUBSCRIPTION_SNAPSHOT_EVENTS.has(payload.event)) return false;

    const entity = payload.payload.subscription?.entity;
    if (!entity?.id) return false;

    const eventCreatedAt = new Date(payload.created_at * 1000);
    const existing = await this.prisma.subscription.findUnique({ where: { providerSubId: entity.id } });

    if (existing?.lastWebhookEventAt && eventCreatedAt < existing.lastWebhookEventAt) {
      // Stale, out-of-order delivery — already recorded in the ledger above
      // for audit purposes, but a later event already moved this row
      // forward; applying this one now would regress it.
      this.logger.warn(`Discarding stale/out-of-order Razorpay webhook ${payload.event} for subscription ${entity.id}`);
      return false;
    }

    const candidateId = existing?.candidateId ?? entity.notes?.candidateId;
    if (!candidateId) {
      this.logger.warn(
        `Razorpay subscription ${entity.id} has no existing row and no notes.candidateId — cannot attribute ${payload.event}`,
      );
      return false;
    }

    const status = STATUS_MAP[entity.status];
    if (!status) {
      this.logger.warn(`Unrecognized Razorpay subscription status "${entity.status}" on ${payload.event} for ${entity.id}`);
      return false;
    }

    const currentPeriodStart = entity.current_start ? new Date(entity.current_start * 1000) : (existing?.currentPeriodStart ?? new Date());
    const currentPeriodEnd = entity.current_end ? new Date(entity.current_end * 1000) : (existing?.currentPeriodEnd ?? null);

    await this.prisma.subscription.upsert({
      where: { candidateId },
      update: {
        tier: SubscriptionTier.PREMIUM,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        provider: 'razorpay',
        providerSubId: entity.id,
        providerPlanId: entity.plan_id,
        lastWebhookEventAt: eventCreatedAt,
      },
      create: {
        candidateId,
        tier: SubscriptionTier.PREMIUM,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        provider: 'razorpay',
        providerSubId: entity.id,
        providerPlanId: entity.plan_id,
        lastWebhookEventAt: eventCreatedAt,
      },
    });

    if (payload.event === 'subscription.charged') {
      await this.recordCharge(candidateId, payload);
    }

    return true;
  }

  /**
   * subscription.charged always carries the payment entity for that charge
   * (per Razorpay's own docs) — recorded here rather than also subscribing
   * to the generic payment.captured event, which would otherwise record
   * the exact same charge twice. Deduped on providerPaymentId (same
   * "idempotent on the provider's own id" pattern
   * AssessmentRequestsService.verifyAndCreate uses for razorpayPaymentId)
   * so a redelivered/reprocessed subscription.charged can never create a
   * second Transaction for the same actual payment, independent of the
   * RazorpayWebhookEvent-level dedup above.
   */
  private async recordCharge(candidateId: string, payload: RazorpayWebhookPayload): Promise<void> {
    const payment = payload.payload.payment?.entity;
    if (!payment) {
      this.logger.warn(`subscription.charged for candidate ${candidateId} had no payment entity — nothing to record`);
      return;
    }

    const existingTransaction = await this.prisma.transaction.findFirst({ where: { providerPaymentId: payment.id } });
    if (existingTransaction) return;

    const billingProfileId = await this.billingProfiles.ensureMinimalBillingProfile(candidateId);
    await this.transactions.recordSystemTransaction(billingProfileId, {
      amountPaise: payment.amount,
      currency: payment.currency,
      type: TransactionType.SUBSCRIPTION_CHARGE,
      status: TransactionStatus.SUCCEEDED,
      description: 'MyAmbii Premium subscription charge',
      provider: 'razorpay',
      providerPaymentId: payment.id,
    });
  }
}
