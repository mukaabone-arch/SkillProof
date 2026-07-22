import { SetMetadata } from '@nestjs/common';

/** The countable, monthly-reset metrics EntitlementGuard knows how to enforce — see plans.config.ts's *PerMonth keys. */
export type CountableMetric = 'assessments' | 'applications';

export const REQUIRES_ENTITLEMENT_KEY = 'requiresEntitlement';

/** Marks a route as consuming one unit of `metric` — see EntitlementGuard. */
export const RequiresEntitlement = (metric: CountableMetric) => SetMetadata(REQUIRES_ENTITLEMENT_KEY, metric);
