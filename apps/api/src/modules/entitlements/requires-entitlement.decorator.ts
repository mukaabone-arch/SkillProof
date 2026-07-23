import { SetMetadata } from '@nestjs/common';

/** The countable, monthly-reset metrics EntitlementGuard knows how to enforce — see plans.config.ts's *PerMonth keys. */
export type CountableMetric = 'assessments' | 'applications';

/**
 * A plain boolean feature flag from PlanLimits (not countable, no
 * UsageCounter row) — EntitlementGuard checks it directly against
 * PLANS[tier] instead of incrementing anything. Add a name here only when
 * it's genuinely a static per-tier on/off flag, not something usage-based
 * that belongs in CountableMetric instead.
 */
export type BooleanFeature = 'interviewPrep';

export type EntitlementGate = CountableMetric | BooleanFeature;

export const REQUIRES_ENTITLEMENT_KEY = 'requiresEntitlement';

/**
 * Marks a route as gated on `gate` — either consuming one unit of a
 * countable metric, or requiring a boolean PlanLimits feature to be true.
 * See EntitlementGuard for which path a given gate takes.
 */
export const RequiresEntitlement = (gate: EntitlementGate) => SetMetadata(REQUIRES_ENTITLEMENT_KEY, gate);
