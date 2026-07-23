import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { EntitlementsService } from './entitlements.service';
import { BooleanFeature, CountableMetric, EntitlementGate, REQUIRES_ENTITLEMENT_KEY } from './requires-entitlement.decorator';

/**
 * What EntitlementGuard charged for this request, read back by
 * EntitlementRefundInterceptor if the controller subsequently throws.
 * `refunded` starts false and is flipped to true the moment a refund is
 * attempted — the interceptor checks it before acting, so this same charge
 * can never be refunded twice for one request (see that interceptor's own
 * doc comment). Never set at all for a BooleanFeature gate — see
 * canActivate below — so EntitlementRefundInterceptor's `!charge` check
 * already no-ops correctly for those routes with no changes needed there.
 */
export interface EntitlementCharge {
  metric: CountableMetric;
  refunded: boolean;
}

export interface EntitlementChargedRequest extends AuthenticatedRequest {
  entitlementCharge?: EntitlementCharge;
}

const BOOLEAN_FEATURES: BooleanFeature[] = ['interviewPrep'];

function isBooleanFeature(gate: EntitlementGate): gate is BooleanFeature {
  return (BOOLEAN_FEATURES as string[]).includes(gate);
}

/**
 * Runs after JwtAuthGuard (needs req.user already set). Reads the tier
 * server-side from the candidate's own Subscription row every time — never
 * trusts anything the client sent (no tier/limit ever comes from the
 * request). A route with no @RequiresEntitlement metadata passes through
 * untouched.
 *
 * Two gate kinds, one guard: a CountableMetric charges a unit
 * (checkAndIncrement) and marks req.entitlementCharge so
 * EntitlementRefundInterceptor can reverse it later; a BooleanFeature is
 * just a direct PLANS[tier] check (assertFeatureEntitled) with nothing to
 * charge or refund — there's no unit consumed, so no marker is set for
 * that case. Either path throws EntitlementLimitException (402) itself on
 * a breach; this guard just lets it propagate.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gate = this.reflector.getAllAndOverride<EntitlementGate | undefined>(REQUIRES_ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!gate) return true;

    const req = context.switchToHttp().getRequest<EntitlementChargedRequest>();

    if (isBooleanFeature(gate)) {
      await this.entitlements.assertFeatureEntitled(req.user.sub, gate);
      return true;
    }

    await this.entitlements.checkAndIncrement(req.user.sub, gate);
    req.entitlementCharge = { metric: gate, refunded: false };
    return true;
  }
}
