# Entitlements

Foundation work for subscription tiers (Free / Premium). No payment provider
is integrated yet — tier is set manually via `POST
/admin/candidates/:candidateProfileId/subscription` (see `AdminController`).
All limits and feature flags live in `apps/api/src/config/plans.config.ts`
(`PLANS`) — nothing in this module, or anywhere enforcing an entitlement,
should ever hardcode a number instead of reading it from there.

## GET /me/entitlements

Both the web and mobile clients render every upgrade/limit-reached gate from
this response alone — **its shape is a stable contract**. Changing a field
name or removing a field is a breaking change for both clients; adding a new
field is safe.

```jsonc
{
  "tier": "FREE", // or "PREMIUM" — the candidate's *effective* tier right now (see resolveEffectiveTier)
  "limits": {
    // The full PLANS[tier] entry — see plans.config.ts's PlanLimits for the
    // exact keys (assessmentsPerMonth, retakeCooldownDays,
    // retakesPerSkillLifetime, applicationsPerMonth, profileViewers,
    // applicationStatusDetail, searchRankBoost, gapAnalysis, resumeBranding,
    // resumeTemplates, interviewPrep). A numeric limit of `null` means
    // unlimited.
  },
  "usage": {
    "assessments": { "used": 1, "limit": 2, "resetsAt": "2026-08-01T00:00:00.000Z" },
    "applications": { "used": 4, "limit": 10, "resetsAt": "2026-08-01T00:00:00.000Z" }
  }
}
```

- `limit: null` on a usage entry means unlimited (mirrors the `limits` entry
  it's derived from) — clients must check for `null` before rendering a
  progress bar or "X of Y" string.
- `resetsAt` is always the start of the next UTC calendar month, regardless
  of tier — usage counters reset on calendar-month boundaries, not a
  rolling window.
- `usage` only ever reports the two countable, monthly-reset metrics
  (`assessments`, `applications`) — the ones `EntitlementGuard` actually
  enforces via `@RequiresEntitlement`. Retake limits
  (`retakeCooldownDays`/`retakesPerSkillLifetime`) are per-skill, not
  monthly, and aren't part of this response's `usage` block; they surface
  per-skill instead, alongside the assessment catalog.

## Enforcement

- `EntitlementGuard` + `@RequiresEntitlement('assessments' | 'applications')`
  gate `POST /assessments/:id/attempts` and `POST /jobs/:id/apply`. On a
  breach they throw **HTTP 402** with:

  ```json
  { "code": "LIMIT_REACHED", "metric": "assessments", "limit": 2, "resetsAt": "2026-08-01T00:00:00.000Z" }
  ```

- `EntitlementsService.checkRetakeEligibility` (called directly from
  `AssessmentsService.startAttempt`, not through the guard, since it needs
  the target skill) enforces `retakeCooldownDays` /
  `retakesPerSkillLifetime` and returns the same 402 shape, with
  `metric: 'retakeCooldownDays'` or `metric: 'retakesPerSkillLifetime'`.
  A lifetime-cap breach has `resetsAt: null` — there is no reset.

- The tier is **always** resolved server-side from the candidate's
  `Subscription` row (`resolveEffectiveTier`) — a client can never send a
  tier value that's trusted.

## Grace period

`PAST_DUE` keeps `PREMIUM` entitlements for 7 days after
`currentPeriodEnd` (UPI autopay retries are common) before falling back to
`FREE`. `CANCELED`/`EXPIRED` drop to `FREE` immediately. None of this ever
revokes an already-issued `Badge` or a submitted `Application` — expiry is
forward-looking capability only.
