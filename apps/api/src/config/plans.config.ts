import { SubscriptionTier } from '@prisma/client';

/**
 * Single source of truth for what each subscription tier gets. Every limit
 * or feature flag referenced anywhere in entitlement enforcement (guards,
 * services, controllers) must read from PLANS — never a hardcoded number.
 * Bumping a limit, or adding a new gated capability, should only ever mean
 * editing this file.
 *
 * `null` on a numeric limit means unlimited (see assessmentsPerMonth on
 * both tiers, applicationsPerMonth on PREMIUM) — callers must check for
 * `null` before doing arithmetic with a limit, never treat it as 0 or
 * Infinity implicitly.
 */
export interface PlanLimits {
  /** Assessment (MCQ) attempt starts allowed per calendar month. null = unlimited. Unlimited on both tiers — see PLANS below. */
  assessmentsPerMonth: number | null;
  /**
   * AI discussion-session (conversational assessor, RAG Systems L2 — see
   * src/modules/assessment-sessions) starts allowed per calendar month.
   * null = unlimited (not used by either tier today). Distinct metric from
   * assessmentsPerMonth on purpose — MCQ and discussion are two separate
   * assessment formats with independent quotas, not one shared pool.
   * FREE's value is time-limited (a promotional window) rather than a
   * plain number — see PLANS.FREE's own getter below and
   * isAiDiscussionPromoActive/AI_DISCUSSION_PROMO_LAUNCH_DATE.
   */
  discussionSessionsPerMonth: number | null;
  /**
   * Days a candidate must wait after a failed/prior attempt before retaking
   * the same skill (any level) — 0 means no cooldown. See
   * EntitlementsService.checkRetakeEligibility.
   */
  retakeCooldownDays: number;
  /**
   * Hard lifetime cap on retakes per skill (not counting the first attempt)
   * — this survives even on PREMIUM, which only removes the cooldown, so a
   * badge can never be inflated by unlimited retries regardless of tier.
   */
  retakesPerSkillLifetime: number;
  /** Job applications allowed per calendar month. null = unlimited. */
  applicationsPerMonth: number | null;
  /** What a candidate sees about who viewed their profile — see ProfileViewsService.getViewersForCandidate. */
  profileViewers: 'count_only' | 'full';
  /** Whether GET /applications/me exposes granular per-application status detail, or just a coarse state. */
  applicationStatusDetail: boolean;
  /** Tiebreaker boost applied within an existing match-score band — see scoring.ts's scoreBand/compareByMatchRank. Never added to the raw score. */
  searchRankBoost: number;
  /**
   * Depth of the candidate-facing skill-gap analysis on the jobs/matched
   * view — see PLANS.PREMIUM's own comment below for what 'detailed'
   * actually means today (never salary-band mapping, and why).
   */
  gapAnalysis: 'basic' | 'detailed';
  /** Whether MyAmbii branding appears on the generated resume PDF. */
  resumeBranding: boolean;
  /**
   * Resume template ids available to choose from. Both tiers currently
   * resolve to ['default'] — see PLANS.PREMIUM's own comment below for why
   * that's not yet a real differentiator.
   */
  resumeTemplates: string[];
  /** Whether interview-prep content/features are available. */
  interviewPrep: boolean;
  /**
   * Employer team seats: max OrgMember rows (existing members + outstanding
   * PENDING invitations — see OrgMembersService.countUsedSeats) an
   * Organization may hold at once. Organizations have no subscription tier
   * of their own today (only CandidateProfile does — see this file's own
   * doc comment above), so OrgMembersService always reads this off
   * PLANS.FREE regardless of which employer is asking; both tiers carry the
   * same value for now so that reference point is arbitrary, not a claim
   * that employer orgs are "free-tier." Kept here rather than a bare
   * constant in OrgMembersService so it still obeys this file's own rule
   * (never hardcode a limit outside PLANS) and stays one place to bump.
   */
  maxOrgMembers: number;
}

/**
 * Launch instant for the AI-discussion promotional FREE allowance — see
 * isAiDiscussionPromoActive below. UTC, not IST: every other date
 * computation in this codebase that deals with monthly/window boundaries
 * (entitlements.service.ts's periodStartOf/nextPeriodStartOf, and
 * resolveEffectiveTier's PAST_DUE grace window in that same file) is plain
 * UTC arithmetic with no timezone conversion anywhere — introducing
 * IST-aware handling for just
 * this one constant would be a new, unprecedented pattern in this file, for
 * a promotional window where the few hours' difference against IST
 * midnight doesn't matter the way a billing-cycle boundary would.
 * 2026-08-24T00:00:00.000Z is 05:30 IST that same morning — so this ends
 * the promo about 5.5 hours before IST midnight on the equivalent day
 * three months later, never after.
 */
export const AI_DISCUSSION_PROMO_LAUNCH_DATE = new Date('2026-08-24T00:00:00.000Z');
const AI_DISCUSSION_PROMO_MONTHS = 3;

/**
 * True from AI_DISCUSSION_PROMO_LAUNCH_DATE (inclusive) up to (not
 * including) the same UTC calendar day+time three months later —
 * [2026-08-24T00:00:00.000Z, 2026-11-24T00:00:00.000Z) for the launch date
 * above. Both boundaries matter: without the lower one, deploying this
 * code ahead of the actual launch would let FREE candidates start getting
 * discussion sessions before the promo is meant to be live — if launch
 * slips, AI_DISCUSSION_PROMO_LAUNCH_DATE gets moved deliberately, not
 * inferred from whenever this code happened to ship. Exported standalone
 * (not just embedded in PLANS.FREE's getter below) so it's independently
 * unit-testable with an injected `now`, same shape as
 * resolveEffectiveTier(subscription, now) in entitlements.service.ts.
 */
export function isAiDiscussionPromoActive(now: Date = new Date()): boolean {
  const promoEndsAt = new Date(AI_DISCUSSION_PROMO_LAUNCH_DATE);
  promoEndsAt.setUTCMonth(promoEndsAt.getUTCMonth() + AI_DISCUSSION_PROMO_MONTHS);
  return now >= AI_DISCUSSION_PROMO_LAUNCH_DATE && now < promoEndsAt;
}

export const PLANS: Record<SubscriptionTier, PlanLimits> = {
  [SubscriptionTier.FREE]: {
    // Unlimited on both tiers as of the discussion-sessions metering
    // change — MCQ starts are no longer the thing FREE's quota gates.
    assessmentsPerMonth: null,
    // A getter, not a plain value: PLANS is a module-level object built
    // once at process start, but this value depends on wall-clock time
    // relative to the promo window and must be re-evaluated on every read,
    // not frozen at boot. A getter on a plain object literal re-runs on
    // every property access — including through JSON.stringify, which is
    // how this reaches GET /plans and GET /me/entitlements — so this
    // stays correct for the life of the process with no cache to
    // invalidate. Verified directly against the running API, not assumed
    // (see entitlements.service.spec.ts's promo-window tests).
    get discussionSessionsPerMonth() {
      return isAiDiscussionPromoActive() ? 1 : 0;
    },
    retakeCooldownDays: 60,
    retakesPerSkillLifetime: 1,
    applicationsPerMonth: 10,
    profileViewers: 'count_only',
    applicationStatusDetail: false,
    searchRankBoost: 0,
    gapAnalysis: 'basic',
    resumeBranding: true,
    resumeTemplates: ['default'],
    interviewPrep: false,
    maxOrgMembers: 5,
  },
  [SubscriptionTier.PREMIUM]: {
    assessmentsPerMonth: null,
    // Static, unlike FREE's — PREMIUM was never part of the promotional
    // window, it's the plain ongoing entitlement.
    discussionSessionsPerMonth: 2,
    retakeCooldownDays: 0,
    retakesPerSkillLifetime: 3,
    applicationsPerMonth: null,
    profileViewers: 'full',
    applicationStatusDetail: true,
    searchRankBoost: 1,
    // 'detailed' means missing skills are ranked by role impact — required
    // for this specific job surfaced ahead of nice-to-have (see
    // JobDetailPage's GapAnalysis component, which derives this from
    // job.skills' own isRequired flag) — never salary-band mapping. Job
    // postings largely lack salary data, so there's no real range to map a
    // gap onto; claiming that would advertise a capability with nothing
    // behind it. Config must not promise more than the product delivers —
    // same rationale as resumeTemplates below. Revisit salary-band mapping
    // once job salary data coverage is high enough to make it meaningful;
    // this isn't an oversight until then.
    gapAnalysis: 'detailed',
    resumeBranding: false,
    // Intentionally ['default'] for now, not a typo/oversight: the PDF
    // generator (resume-pdf.builder.ts) only implements one layout today.
    // Config must not promise more than enforcement can honor — the
    // /upgrade page and the entitlement check both read this array
    // directly, so claiming templates that don't exist would advertise a
    // capability with nothing behind it. Add real entries here (and the
    // matching layouts in resume-pdf.builder.ts) when they're built; no
    // client changes are needed when that happens, since both apps already
    // just render whatever this array contains.
    resumeTemplates: ['default'],
    interviewPrep: true,
    maxOrgMembers: 5,
  },
};
