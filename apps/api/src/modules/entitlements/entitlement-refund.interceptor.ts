import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { EntitlementsService } from './entitlements.service';
import { EntitlementChargedRequest } from './entitlement.guard';

/**
 * Pairs with EntitlementGuard — reverses a charge the guard made when the
 * request that consumed it didn't actually succeed. Registered globally
 * (see EntitlementsModule's APP_INTERCEPTOR provider), so it runs for
 * every request; it's a no-op unless the guard left a
 * req.entitlementCharge marker, which only happens on a route decorated
 * with @RequiresEntitlement whose charge actually went through. This
 * means a future @RequiresEntitlement route is covered automatically —
 * nothing has to remember to pair the two by hand per-route.
 *
 * Reuses EntitlementsService.refund — the exact same bounded-at-zero
 * decrement AssessmentsService.startAttempt already calls for its
 * idempotent-resume case. This is not a second decrement mechanism, just
 * a second caller of the one that already existed.
 *
 * Refund on: any 4xx thrown downstream of the guard (validation errors,
 * not-found, forbidden, conflict, precondition failures) — the candidate
 * didn't get whatever the unit was supposed to buy, so charging them for
 * it reads as a bug (or as being cheated) on the exact metric being
 * monetized.
 *
 * Do NOT refund on:
 *  - 402 (EntitlementLimitException) — no unit was charged for that
 *    response; the guard rejects *before* incrementing on a breach, so
 *    there is nothing to reverse.
 *  - 5xx (or any non-HttpException error, treated the same way) — the
 *    request may have partially succeeded server-side and state is
 *    uncertain. A wrongly-issued refund (an extra unit for a request that
 *    actually went through) is worse than a conservative charge the
 *    candidate can raise as a support issue — logged instead so it's at
 *    least visible.
 *
 * Not fully transactional: the charge (in the guard) and the refund (here)
 * are separate operations, so a process crash between them leaves the unit
 * charged with no refund. Accepted — this converts what would otherwise be
 * systematic drift (every downstream failure permanently costs a unit)
 * into a genuinely rare edge case (only a crash in the exact window between
 * charge and refund does).
 */
@Injectable()
export class EntitlementRefundInterceptor implements NestInterceptor {
  private readonly logger = new Logger(EntitlementRefundInterceptor.name);

  constructor(private readonly entitlements: EntitlementsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<EntitlementChargedRequest>();

    return next.handle().pipe(
      catchError((err: unknown) => {
        const charge = req.entitlementCharge;
        if (!charge || charge.refunded) return throwError(() => err);

        const status = err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
        const isLimitBreach = status === HttpStatus.PAYMENT_REQUIRED;
        const shouldRefund = !isLimitBreach && status >= 400 && status < 500;

        if (!shouldRefund) {
          if (!isLimitBreach && status >= 500) {
            this.logger.warn(
              `Not refunding '${charge.metric}' charge for user ${req.user?.sub} — request failed with status ${status}; state uncertain, leaving the unit charged.`,
            );
          }
          return throwError(() => err);
        }

        // Idempotent per request: flipped before the async refund even
        // starts, so a re-entrant catchError for this same request (not
        // expected under normal Nest/RxJS execution, but defensive) sees
        // refunded: true above and does nothing.
        charge.refunded = true;

        return from(this.entitlements.refund(req.user.sub, charge.metric)).pipe(
          catchError((refundErr: unknown) => {
            this.logger.error(
              `Failed to refund '${charge.metric}' charge for user ${req.user?.sub}`,
              refundErr instanceof Error ? refundErr.stack : String(refundErr),
            );
            return of(null); // swallow — the candidate still sees their original error below, not this one
          }),
          mergeMap(() => throwError(() => err)), // always rethrow the original error, refund outcome notwithstanding
        );
      }),
    );
  }
}
