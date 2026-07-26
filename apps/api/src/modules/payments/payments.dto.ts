import { IsString } from 'class-validator';

/** The three values Razorpay Checkout hands back to the client's success handler — see PaymentsService.verifyTestPayment. */
export class VerifyPaymentDto {
  @IsString()
  razorpay_order_id: string;

  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_signature: string;
}

/** STEP 0 verification harness (feat/employer-triggered-assessment) — capturing a previously-authorized payment. */
export class CapturePaymentDto {
  @IsString()
  paymentId: string;
}
