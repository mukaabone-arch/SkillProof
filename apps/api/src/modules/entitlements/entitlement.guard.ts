import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { EntitlementsService } from './entitlements.service';
import { REQUIRES_ENTITLEMENT_KEY, CountableMetric } from './requires-entitlement.decorator';

/**
 * What EntitlementGuard charged for this request, read back by
 * EntitlementRefundInterceptor if the controller subsequently throws.
 * `refunded` starts false and is flipped to true the moment a refund is
 * attempted — the interceptor checks it before acting, so this same charge
 * can never be refunded twice for one request (see that interceptor's own
 * doc comment).
 */
export interface EntitlementCharge {
  metric: CountableMetric;
  refunded: boolean;
}

export interface EntitlementChargedRequest extends AuthenticatedRequest {
  entitlementCharge?: EntitlementCharge;
}

/**
 * Runs after JwtAuthGuard (needs req.user already set). Reads the tier
 * server-side from the candidate's own Subscription row every time — never
 * trusts anything the client sent (no tier/limit ever comes from the
 * request). A route with no @RequiresEntitlement metadata passes through
 * untouched. On a limit breach, EntitlementsService.checkAndIncrement
 * throws EntitlementLimitException (402) itself — this guard just lets it
 * propagate (nothing was charged in that case, so there's nothing to mark).
 *
 * Once a charge succeeds, marks the request with what was charged
 * (req.entitlementCharge) so EntitlementRefundInterceptor — a global
 * interceptor, see EntitlementsModule — can reverse it if the request that
 * consumed it turns out not to have actually succeeded downstream.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metric = this.reflector.getAllAndOverride<CountableMetric | undefined>(REQUIRES_ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metric) return true;

    const req = context.switchToHttp().getRequest<EntitlementChargedRequest>();
    await this.entitlements.checkAndIncrement(req.user.sub, metric);
    req.entitlementCharge = { metric, refunded: false };
    return true;
  }
}
