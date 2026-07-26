import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { VerifyPaymentDto } from './payments.dto';

/**
 * Throwaway Razorpay test-mode plumbing (`feat/razorpay-test`) — proves
 * order-creation and signature verification work end-to-end before the
 * real subscription/billing system is built. NOT wired to Subscription,
 * SubscriptionTier, trial logic, or any real feature; a fixed ₹100 test
 * order every time (see PaymentsService). No auth guard — this is a pure
 * connectivity check with nothing user-specific to protect, not a purchase
 * of anything real. Safe to delete once the real integration replaces it.
 */
@Controller('payments/test')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('create-order')
  @HttpCode(200)
  createOrder() {
    return this.payments.createTestOrder();
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyPaymentDto) {
    return this.payments.verifyTestPayment(dto.razorpay_order_id, dto.razorpay_payment_id, dto.razorpay_signature);
  }
}
