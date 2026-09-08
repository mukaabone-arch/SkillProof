/**
 * Server-evaluated feature flags — the kill-switch pattern for a feature
 * whose launch date is known but not yet live. Not a database table or an
 * admin-editable toggle: flipping one of these means changing the env var
 * and redeploying, the same way every other environment-driven config in
 * this codebase (RAZORPAY_PLAN_ID_MONTHLY, GOOGLE_PLACES_API_KEY, ...)
 * already works. That's deliberate — a flag gating real payment/entitlement
 * behavior shouldn't be flippable by anything short of a deploy.
 */

/**
 * Candidate premium subscriptions — target launch 14 November 2026 (internal
 * only; public copy says "November," never the exact date — see the
 * candidate /upgrade page). Default OFF (unset, or anything other than the
 * literal string 'true', is OFF) so a fresh environment never ships premium
 * live by omission.
 *
 * Gates exactly one thing: SubscriptionsService.initiateCheckout, the only
 * self-serve path a candidate can use to *become* premium. Deliberately does
 * NOT gate cancel, switchPlan, or the admin manual-grant endpoint
 * (POST /admin/candidates/:id/subscription) — those all require an existing
 * subscription or admin access already, so gating them would either strand
 * a real cancellation behind a flag or block the exact admin path that
 * creates the internal test accounts meant to exercise these gates before
 * launch. It also never touches RazorpayWebhookService — a payment already
 * authorized before this flag flips can still be recorded normally; the
 * flag only ever prevents a *new* checkout from starting.
 */
export function isCandidatePremiumEnabled(): boolean {
  return process.env.CANDIDATE_PREMIUM_ENABLED === 'true';
}
