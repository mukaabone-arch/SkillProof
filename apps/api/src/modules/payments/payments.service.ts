import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import Razorpay from 'razorpay';

/** ₹100 in paise — Razorpay amounts are always the smallest currency unit. Hardcoded: this order never varies. */
const TEST_AMOUNT_PAISE = 10000;
const TEST_CURRENCY = 'INR';

/**
 * Throwaway dummy checkout proving Razorpay connectivity end-to-end (order
 * creation -> Checkout -> signature verification) before the real
 * subscription/billing system is built on top of it — see
 * payments.controller.ts's own doc comment. Not wired to Subscription,
 * SubscriptionTier, or any real feature.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly client: Razorpay;

  constructor() {
    this.client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  /**
   * Creates a fixed-amount test order via the Razorpay SDK (Key Secret,
   * server-side only). Only the order id and the Key ID go back to the
   * client — the Key ID is public by design (Razorpay Checkout requires it
   * in the browser to open the payment sheet), the Key Secret never leaves
   * this process.
   */
  async createTestOrder(): Promise<{ orderId: string; keyId: string; amount: number; currency: string }> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId || !process.env.RAZORPAY_KEY_SECRET) {
      throw new BadRequestException(
        'Razorpay is not configured — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET (test-mode keys from the Razorpay dashboard).',
      );
    }

    const order = await this.client.orders.create({
      amount: TEST_AMOUNT_PAISE,
      currency: TEST_CURRENCY,
      receipt: `test_${Date.now()}`,
    });

    return { orderId: order.id, keyId, amount: TEST_AMOUNT_PAISE, currency: TEST_CURRENCY };
  }

  /**
   * The one security-critical step in this whole dummy flow. Razorpay
   * Checkout's success handler runs entirely in the browser, so a client
   * simply *claiming* "payment succeeded" proves nothing — anyone could
   * call this endpoint with made-up ids. The signature Checkout hands back
   * is an HMAC-SHA256 of "{order_id}|{payment_id}", keyed with the Key
   * Secret that only Razorpay and this backend ever hold; Razorpay
   * computes and returns it only after a real payment actually completes.
   * A signature that verifies here is the actual proof of payment — the
   * client's success callback firing is not. Constant-time comparison
   * (timingSafeEqual, not `===`) so response timing can't leak how many
   * bytes of a guessed signature were correct; the length check before it
   * is required because timingSafeEqual throws (rather than returning
   * false) on mismatched buffer lengths.
   */
  verifyTestPayment(orderId: string, paymentId: string, signature: string): { verified: boolean } {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new BadRequestException('Razorpay is not configured — set RAZORPAY_KEY_SECRET.');
    }

    const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    const verified = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);

    if (!verified) {
      this.logger.warn('Razorpay test payment signature verification failed');
    }

    return { verified };
  }

  // ---------- STEP 0 verification harness (feat/employer-triggered-assessment) ----------
  // Not part of the throwaway checkout above — these three prove manual
  // capture (authorize now, capture later, auto-refund if never captured)
  // actually works for this account before the employer-triggered-
  // assessment feature is built on top of it. See docs/razorpay-manual-capture.md
  // (if present) or the STEP 0 report for what's already confirmed from
  // Razorpay's docs; a real test-mode transaction through these three
  // endpoints is what confirms it for real. Delete this section once that's
  // done and the real AssessmentRequest flow has its own capture logic.

  /**
   * Same fixed test order as createTestOrder, except `payment.capture:
   * 'manual'` — Checkout will authorize the payment (hold the funds) but
   * NOT auto-capture it. manual_expiry_period is Razorpay's own maximum
   * (7200 minutes = exactly 5 days, confirmed via their capture-settings
   * API docs) — the same window the real feature's 5-day candidate
   * response window is built around. If nothing captures it before then,
   * Razorpay auto-refunds it on its own; there is no explicit "void" API
   * to call.
   */
  async createAuthOnlyOrder(): Promise<{ orderId: string; keyId: string; amount: number; currency: string }> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId || !process.env.RAZORPAY_KEY_SECRET) {
      throw new BadRequestException(
        'Razorpay is not configured — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET (test-mode keys from the Razorpay dashboard).',
      );
    }

    const order = await this.client.orders.create({
      amount: TEST_AMOUNT_PAISE,
      currency: TEST_CURRENCY,
      receipt: `authtest_${Date.now()}`,
      payment: {
        capture: 'manual',
        // automatic_expiry_period is only meaningful when capture:
        // 'automatic' — the SDK's types require it regardless, so this is
        // a placeholder at its documented minimum, never actually used.
        capture_options: { automatic_expiry_period: 12, manual_expiry_period: 7200, refund_speed: 'normal' },
      },
    });

    return { orderId: order.id, keyId, amount: TEST_AMOUNT_PAISE, currency: TEST_CURRENCY };
  }

  /** Fetches the payment's live status straight from Razorpay — this is what proves "authorized" really means held-not-charged, and "captured" really means the capture call took effect. */
  async getPaymentStatus(paymentId: string): Promise<{ status: string; amount: number; method: string; captured: boolean }> {
    const payment = await this.client.payments.fetch(paymentId);
    return {
      status: payment.status,
      amount: Number(payment.amount),
      method: payment.method,
      captured: payment.captured,
    };
  }

  /**
   * Captures a previously-authorized payment — the same call the real
   * feature will make at candidate-start. amount/currency must match what
   * was authorized; Razorpay rejects a capture attempt on anything already
   * captured, refunded, or past its manual_expiry_period, which is exactly
   * the double-capture/late-capture protection the real feature depends on
   * (see the STEP 0 report for how AssessmentRequest builds idempotency on
   * top of that rather than reimplementing it).
   */
  async captureTestPayment(paymentId: string): Promise<{ status: string; captured: boolean }> {
    const payment = await this.client.payments.capture(paymentId, TEST_AMOUNT_PAISE, TEST_CURRENCY);
    return { status: payment.status, captured: payment.captured };
  }
}
