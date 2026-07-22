import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown by EntitlementGuard (monthly usage caps) and
 * EntitlementsService.checkRetakeEligibility (retake cooldown/lifetime cap)
 * — the one shape every limit breach in this module returns, so both
 * clients can render a single gate/upsell component off `code` alone.
 * `resetsAt` is null for a lifetime cap (retakesPerSkillLifetime) — there is
 * no reset, the limit exists to be permanent within a skill.
 */
export class EntitlementLimitException extends HttpException {
  constructor(metric: string, limit: number | null, resetsAt: Date | null) {
    super({ code: 'LIMIT_REACHED', metric, limit, resetsAt }, HttpStatus.PAYMENT_REQUIRED);
  }
}
