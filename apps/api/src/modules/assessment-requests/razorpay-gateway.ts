import { Injectable } from '@nestjs/common';
import Razorpay from 'razorpay';

/**
 * Thin seam over the parts of the Razorpay SDK AssessmentRequestsService/
 * AssessmentRequestsRefundJob actually use — mirrors the EMAIL_PROVIDER
 * pattern in notifications/email-provider.interface.ts (an interface +
 * DI token so tests can swap in a fake, same as ResendEmailProvider is
 * swappable there). Not a general-purpose Razorpay wrapper: it only exists
 * to make order-creation/fetch/refund independently testable.
 */
export interface RazorpayGateway {
  createOrder(params: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
  fetchOrder(orderId: string): Promise<{ notes: Record<string, string> | null }>;
  refundPayment(paymentId: string, amount: number): Promise<{ id: string }>;
}

export const RAZORPAY_GATEWAY = Symbol('RAZORPAY_GATEWAY');

@Injectable()
export class RazorpaySdkGateway implements RazorpayGateway {
  private readonly client: Razorpay;

  constructor() {
    this.client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  async createOrder(params: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<{ id: string }> {
    const order = await this.client.orders.create(params);
    return { id: order.id };
  }

  async fetchOrder(orderId: string): Promise<{ notes: Record<string, string> | null }> {
    const order = await this.client.orders.fetch(orderId);
    return { notes: (order.notes as unknown as Record<string, string> | null) ?? null };
  }

  async refundPayment(paymentId: string, amount: number): Promise<{ id: string }> {
    const refund = await this.client.payments.refund(paymentId, { amount, speed: 'normal' });
    return { id: refund.id };
  }
}
