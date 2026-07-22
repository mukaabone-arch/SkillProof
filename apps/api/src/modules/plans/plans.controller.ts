import { Controller, Get } from '@nestjs/common';
import { PLANS } from '../../config/plans.config';

/**
 * Public, unauthenticated, read-only — served straight from PLANS
 * (plans.config.ts) so this can never drift from what EntitlementGuard
 * actually enforces. Powers the candidate /upgrade comparison page.
 *
 * Shaped as { tiers: { FREE, PREMIUM } } rather than a flat
 * { FREE, PREMIUM } object so adding a future tier, or top-level metadata
 * alongside `tiers`, never requires a breaking response-shape change.
 */
@Controller('plans')
export class PlansController {
  @Get()
  list() {
    return { tiers: PLANS };
  }
}
