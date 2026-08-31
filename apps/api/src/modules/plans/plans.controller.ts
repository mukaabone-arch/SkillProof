import { Controller, Get } from '@nestjs/common';
import { PLANS, defaultPricingFor } from '../../config/plans.config';
import { GST_RATE } from '../../config/gst.config';

/**
 * Public, unauthenticated, read-only — served straight from PLANS
 * (plans.config.ts) so this can never drift from what EntitlementGuard
 * actually enforces. Powers the candidate /upgrade comparison page.
 *
 * Shaped as { tiers: { FREE, PREMIUM } } rather than a flat
 * { FREE, PREMIUM } object so adding a future tier, or top-level metadata
 * alongside `tiers`, never requires a breaking response-shape change.
 *
 * `pricing` computed via defaultPricingFor (gst.config.ts's splitGst
 * against the default place of supply) rather than a second hardcoded
 * ₹299/₹2,999 — this is the one place the frontend gets base/gst/total
 * numbers from, for both the pricing-page copy and the checkout breakdown,
 * so it never has to multiply by 1.18 itself. Deliberately the DEFAULT
 * split (Maharashtra) even for a logged-in candidate whose real state may
 * differ — GET /plans is unauthenticated and has no candidate context to
 * price against; the actual charge always uses that candidate's own
 * BillingProfile.gstStateCode at charge time (see
 * RazorpayWebhookService.recordCharge), this is display-only.
 */
@Controller('plans')
export class PlansController {
  @Get()
  list() {
    return {
      tiers: PLANS,
      pricing: {
        gstRate: GST_RATE,
        MONTHLY: defaultPricingFor('MONTHLY'),
        ANNUAL: defaultPricingFor('ANNUAL'),
      },
    };
  }
}
