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
}
