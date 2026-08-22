import { BadRequestException, Controller, Headers, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { RazorpayWebhookService } from './razorpay-webhook.service';

/**
 * No auth guard — Razorpay cannot send a JWT. Signature verification below
 * is the entire security boundary; anything that fails it never reaches
 * RazorpayWebhookService. Not under /admin or /me — this is a
 * server-to-server endpoint, not a candidate- or admin-facing one.
 */
@Controller('webhooks/razorpay')
export class RazorpayWebhookController {
  constructor(private readonly webhooks: RazorpayWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature: string | undefined) {
    if (!req.rawBody) {
      // Should be unreachable in production (main.ts sets rawBody: true
      // globally) — a missing raw body here means signature verification
      // is impossible, so this must never be treated as "unverified but
      // proceed anyway".
      throw new BadRequestException('Raw request body is unavailable — cannot verify signature.');
    }

    if (!this.webhooks.verifySignature(req.rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature.');
    }

    const eventId = req.headers['x-razorpay-event-id'];
    if (typeof eventId !== 'string' || !eventId) {
      throw new BadRequestException('Missing x-razorpay-event-id header.');
    }

    const payload = JSON.parse(req.rawBody.toString('utf8'));
    await this.webhooks.handle(eventId, payload);
    return { received: true };
  }
}
