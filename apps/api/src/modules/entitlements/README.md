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
    "assessments": { "used": 1, "limit": null, "resetsAt": "2026-08-01T00:00:00.000Z" },
    "applications": { "used": 4, "limit": 10, "resetsAt": "2026-08-01T00:00:00.000Z" },
    "discussionSessions": { "used": 0, "limit": 1, "resetsAt": "2026-08-01T00:00:00.000Z" }
  }
}
```

- `limit: null` on a usage entry means unlimited (mirrors the `limits` entry
  it's derived from) — clients must check for `null` before rendering a
  progress bar or "X of Y" string. `assessmentsPerMonth` (MCQ) is `null` on
  both tiers as of the discussion-sessions split below — the metric is
  still charged/tracked (see `EntitlementGuard`) so this field stays
  present and shaped the same either way, it just never blocks.
- `resetsAt` is always the start of the next UTC calendar month, regardless
  of tier — usage counters reset on calendar-month boundaries, not a
  rolling window.
- `usage` reports the three countable, monthly-reset metrics
  (`assessments`, `applications`, `discussionSessions`) — the ones
  `EntitlementGuard` actually enforces via `@RequiresEntitlement`. MCQ
  assessments (`assessmentsPerMonth`) and AI discussion sessions
  (`discussionSessionsPerMonth`) are deliberately separate metrics with
  independent quotas, not one shared "assessments" pool, even though both
  are ways of earning a badge — see `src/modules/assessment-sessions` for
  the discussion format. Retake limits
  (`retakeCooldownDays`/`retakesPerSkillLifetime`) are per-skill, not
  monthly, and aren't part of this response's `usage` block; they surface
  per-skill instead, alongside the assessment catalog.
- FREE's `discussionSessionsPerMonth` is time-limited, not a plain static
  number — 1/month during a promotional window ending three months after
  launch (`AI_DISCUSSION_PROMO_LAUNCH_DATE` in `plans.config.ts`), 0/month
  after. Implemented as a getter on `PLANS.FREE` (plain object literals
  support accessor properties; a getter re-runs on every read, including
  through `JSON.stringify`, which is how this reaches both `GET /plans` and
  this endpoint) rather than a plain value, since `PLANS` is built once at
  process start and this value depends on wall-clock time, not anything
  fixed at boot.

## Enforcement

- `EntitlementGuard` +
  `@RequiresEntitlement('assessments' | 'applications' | 'discussionSessions')`
  gate `POST /assessments/:id/attempts` (MCQ), `POST /jobs/:id/apply`, and
  `POST /assessment-sessions` (AI discussion) respectively. On a breach they
  throw **HTTP 402** with:

  ```json
  { "code": "LIMIT_REACHED", "metric": "discussionSessions", "limit": 1, "resetsAt": "2026-09-01T00:00:00.000Z" }
  ```

  MCQ assessment starts are unlimited on both tiers, so this 402 shape is
  never actually reachable for `metric: "assessments"` today — the gate is
  left in place anyway (see plans.config.ts's own comment) since `limit:
  null` already means "count it, never block," which is simpler and safer
  than removing entitlement tracking from that route.

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
