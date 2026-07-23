import { SubscriptionTier } from '@prisma/client';

/**
 * Single source of truth for what each subscription tier gets. Every limit
 * or feature flag referenced anywhere in entitlement enforcement (guards,
 * services, controllers) must read from PLANS — never a hardcoded number.
 * Bumping a limit, or adding a new gated capability, should only ever mean
 * editing this file.
 *
 * `null` on a numeric limit means unlimited (see assessmentsPerMonth /
 * applicationsPerMonth on PREMIUM) — callers must check for `null` before
 * doing arithmetic with a limit, never treat it as 0 or Infinity implicitly.
 */
export interface PlanLimits {
  /** Assessment (MCQ) attempt starts allowed per calendar month. null = unlimited. */
  assessmentsPerMonth: number | null;
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
  /** Whether SkillProof branding appears on the generated resume PDF. */
  resumeBranding: boolean;
  /**
   * Resume template ids available to choose from. Both tiers currently
   * resolve to ['default'] — see PLANS.PREMIUM's own comment below for why
   * that's not yet a real differentiator.
   */
  resumeTemplates: string[];
  /** Whether interview-prep content/features are available. */
  interviewPrep: boolean;
}

export const PLANS: Record<SubscriptionTier, PlanLimits> = {
  [SubscriptionTier.FREE]: {
    assessmentsPerMonth: 2,
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
  },
  [SubscriptionTier.PREMIUM]: {
    assessmentsPerMonth: null,
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
  },
};
