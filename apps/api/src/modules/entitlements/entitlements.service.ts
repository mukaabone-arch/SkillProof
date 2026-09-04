import { Injectable, NotFoundException } from '@nestjs/common';
import { AttemptStatus, SkillLevel, Subscription, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS } from '../../config/plans.config';
import { BooleanFeature, CountableMetric } from './requires-entitlement.decorator';
import { EntitlementLimitException } from './entitlements.errors';

/** PAST_DUE keeps PREMIUM entitlements for this many days after currentPeriodEnd — see resolveEffectiveTier. */
const PAST_DUE_GRACE_DAYS = 7;

const METRIC_LIMIT_KEY: Record<CountableMetric, 'assessmentsPerMonth' | 'applicationsPerMonth' | 'discussionSessionsPerMonth'> = {
  assessments: 'assessmentsPerMonth',
  applications: 'applicationsPerMonth',
  discussionSessions: 'discussionSessionsPerMonth',
};

export interface UsageEntry {
  used: number;
  limit: number | null;
  resetsAt: Date;
}

export interface EntitlementsResponse {
  tier: SubscriptionTier;
  limits: (typeof PLANS)[SubscriptionTier];
  usage: {
    assessments: UsageEntry;
    applications: UsageEntry;
    discussionSessions: UsageEntry;
  };
  /**
   * Present only when limits.singleSkillRestriction is true (FREE today)
   * and the candidate has actually locked a skill (see
   * CandidateProfile.freeSkillLockId) — null before their first self-serve
   * MCQ attempt, and always null for an exempt/grandfathered candidate
   * (freeSkillLockExempt) or on a tier without the restriction. The web/
   * mobile "start assessment" flow reads this to decide whether to show the
   * one-time lock-in notice (limits.singleSkillRestriction is true AND this
   * is null) versus silently proceeding (already locked to this skill, or
   * restriction doesn't apply).
   */
  freeSkillLock: { skillId: string; skillName: string } | null;
}

/** Start of date's UTC calendar month — the fixed boundary UsageCounter.periodStart buckets on. */
export function periodStartOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Start of the UTC calendar month after date's — when a monthly counter next resets. */
export function nextPeriodStartOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * Pure and side-effect-free so it's directly unit-testable (see
 * entitlements.service.spec.ts) and so display (GET /me/entitlements) and
 * enforcement (checkAndIncrement, checkRetakeEligibility) can never
 * disagree about which tier is actually in force right now.
 *
 * No Subscription row at all → FREE (rows are never backfilled — see
 * Subscription's own doc comment in schema.prisma). ACTIVE → whatever tier
 * is set. CANCELED/EXPIRED → FREE immediately, no grace. PAST_DUE → still
 * PREMIUM for up to PAST_DUE_GRACE_DAYS *after currentPeriodEnd* (not after
 * updatedAt — currentPeriodEnd is the actual billing-cycle boundary a
 * renewal was expected to land on; updatedAt could later be touched by
 * something unrelated to billing and would silently extend the grace
 * window if used instead). Falls back to updatedAt only if
 * currentPeriodEnd was never set at all.
 */
export function resolveEffectiveTier(subscription: Subscription | null, now: Date = new Date()): SubscriptionTier {
  if (!subscription) return SubscriptionTier.FREE;

  switch (subscription.status) {
    case SubscriptionStatus.ACTIVE:
      return subscription.tier;
    case SubscriptionStatus.PAST_DUE: {
      if (subscription.tier !== SubscriptionTier.PREMIUM) return SubscriptionTier.FREE;
      const anchor = subscription.currentPeriodEnd ?? subscription.updatedAt;
      const graceEndsAt = new Date(anchor.getTime() + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);
      return now <= graceEndsAt ? SubscriptionTier.PREMIUM : SubscriptionTier.FREE;
    }
    case SubscriptionStatus.CANCELED:
    case SubscriptionStatus.EXPIRED:
    default:
      return SubscriptionTier.FREE;
  }
}

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/entitlements — see this module's README for the response-shape stability contract. */
  async getEntitlements(userId: string): Promise<EntitlementsResponse> {
    const candidateId = await this.ensureProfileId(userId);
    const tier = await this.resolveEffectiveTierForProfile(candidateId);
    const limits = PLANS[tier];

    const [assessments, applications, discussionSessions, profile] = await Promise.all([
      this.readUsage(candidateId, 'assessments', limits.assessmentsPerMonth),
      this.readUsage(candidateId, 'applications', limits.applicationsPerMonth),
      this.readUsage(candidateId, 'discussionSessions', limits.discussionSessionsPerMonth),
      this.prisma.candidateProfile.findUnique({
        where: { id: candidateId },
        select: { freeSkillLockId: true, freeSkillLock: { select: { name: true } } },
      }),
    ]);

    const freeSkillLock =
      profile?.freeSkillLockId && profile.freeSkillLock
        ? { skillId: profile.freeSkillLockId, skillName: profile.freeSkillLock.name }
        : null;

    return { tier, limits, usage: { assessments, applications, discussionSessions }, freeSkillLock };
  }

  /**
   * The enforcement half of GET /me/entitlements's usage numbers —
   * EntitlementGuard's sole job. Resolves the tier server-side every time
   * (never trusts anything the client sent); atomically checks-and-
   * increments the current month's UsageCounter row; throws
   * EntitlementLimitException (402) if that would exceed the tier's limit.
   *
   * Concurrency: a single `INSERT ... ON CONFLICT (...) DO UPDATE ... WHERE
   * count < limit` statement (incrementBounded) is what makes this safe —
   * not a JS-level "check, then decide whether to update or create". An
   * earlier version of this method did read-then-write across two separate
   * statements inside a transaction (updateMany, then create() if missing,
   * catching a unique-violation and retrying); that's broken in Postgres:
   * once any statement inside a transaction errors, the whole transaction
   * is aborted and every later statement fails with "current transaction
   * is aborted" (25P02), so the retry could never actually run. A single
   * INSERT ... ON CONFLICT is one statement — Postgres resolves the
   * conflict and applies the WHERE-gated update atomically under its own
   * row lock, so two simultaneous requests for the same
   * (candidateId, metric, periodStart) can never both succeed past a limit,
   * with no multi-statement transaction (and no such failure mode) needed.
   */
  async checkAndIncrement(userId: string, metric: CountableMetric): Promise<UsageEntry> {
    const candidateId = await this.ensureProfileId(userId);
    const tier = await this.resolveEffectiveTierForProfile(candidateId);
    const limit = PLANS[tier][METRIC_LIMIT_KEY[metric]];
    const now = new Date();
    const periodStart = periodStartOf(now);
    const resetsAt = nextPeriodStartOf(now);

    // incrementBounded's WHERE clause only gates the DO UPDATE branch of
    // its ON CONFLICT — the *first* insert for a fresh (candidateId,
    // metric, periodStart) row always succeeds unconditionally, regardless
    // of `limit`, because there's nothing to conflict with yet on that
    // first call. Every limit this codebase has ever had before
    // discussionSessionsPerMonth's post-promo value was either null or a
    // positive integer, so this never mattered — confirmed directly
    // against Postgres (not assumed) that a limit of exactly 0 would
    // otherwise let precisely one use through per period before blocking
    // the second. Short-circuit before ever touching UsageCounter for that
    // case, rather than trying to make the atomic upsert itself express
    // "reject even the first row" — simpler, and leaves the proven-correct
    // SQL below untouched for every other limit shape.
    if (limit !== null && limit <= 0) {
      throw new EntitlementLimitException(metric, limit, resetsAt);
    }

    const used = await this.incrementBounded(candidateId, metric, periodStart, limit);

    return { used, limit, resetsAt };
  }

  /**
   * The boolean-feature counterpart to checkAndIncrement — no UsageCounter
   * row, nothing to refund, just a direct PLANS[tier] read. Reuses
   * EntitlementLimitException (limit/resetsAt both null, since neither
   * concept applies to a static flag) so every client already handling
   * LIMIT_REACHED for the countable metrics renders *something* sensible
   * here too, rather than needing a second error shape wired up for one
   * feature. EntitlementGuard calls this instead of checkAndIncrement when
   * @RequiresEntitlement names a BooleanFeature — see that guard.
   */
  async assertFeatureEntitled(userId: string, feature: BooleanFeature): Promise<void> {
    const candidateId = await this.ensureProfileId(userId);
    const tier = await this.resolveEffectiveTierForProfile(candidateId);
    if (!PLANS[tier][feature]) {
      throw new EntitlementLimitException(feature, null, null);
    }
  }

  /**
   * Undoes one unit of EntitlementGuard's charge for a request that turned
   * out not to be a genuinely new use. Two callers today:
   *  - AssessmentsService.startAttempt's "you already have an active
   *    attempt for this assessment" idempotent-return path, since that
   *    case returns the *same* attempt rather than starting a new one.
   *  - EntitlementRefundInterceptor, which calls this for any non-402 4xx
   *    thrown after the guard already charged (validation errors,
   *    not-found, forbidden, conflict) — see that interceptor's own doc
   *    comment for exactly which statuses trigger it.
   * Both reuse this single decrement path rather than each rolling their
   * own — bounded at 0 (the `count: { gt: 0 }` guard below), so it never
   * goes negative even under a pathological refund-without-a-matching-charge,
   * and safe to call more than once for the same logical charge (each call
   * just decrements whatever is currently there, floored at 0 — callers
   * that need "at most once" per charge, like the interceptor, enforce
   * that themselves via a per-request flag rather than relying on this
   * method to no-op a repeat).
   */
  async refund(userId: string, metric: CountableMetric): Promise<void> {
    const candidateId = await this.ensureProfileId(userId);
    const periodStart = periodStartOf(new Date());
    await this.prisma.usageCounter.updateMany({
      where: { candidateId, metric, periodStart, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  }

  /**
   * Enforces retakeCooldownDays/retakesPerSkillLifetime and returns the
   * ordinal attemptNumber the caller (AssessmentsService.startAttempt)
   * should stamp on the new Attempt row — one query does both, so the
   * count that gates the attempt and the count stored on it can never
   * disagree.
   *
   * "Prior attempts" = this user's GRADED attempts at this exact skill+level
   * — CREATED/IN_PROGRESS attempts don't count (nothing to retake yet), and
   * a level's very first attempt is never gated by either rule regardless
   * of tier. Scoped to skill+level, NOT skill-wide: each level is its own
   * assessment with its own retake budget, so passing L1 then attempting L2
   * is a first attempt at a *different* assessment, not a retake, and must
   * never draw against L1's budget. (Previously scoped to skill-wide across
   * every level — that meant a FREE candidate who cleanly passed two levels
   * of their one locked skill had already exhausted the shared budget and
   * was blocked from a third level's first-ever attempt, misreported as a
   * "retake limit reached." That collided with the single-skill-lock
   * feature's whole promise — a locked skill's three levels are what a FREE
   * candidate is told they get — so this was a bug in the cap's scope, not
   * a variant of the free-skill lock working as intended.)
   *
   * attemptNumber is the lifetime count *at this level* (not summed across
   * the skill's other levels) — it's copied onto Badge.attemptNumber and
   * shown publicly ("earned on attempt #N"), and under per-level scoping
   * that N is honestly "the Nth time this specific assessment was
   * attempted," matching what a candidate/employer would actually assume
   * attempt-numbering means. Only the *cap check* below is windowed by lapse.
   *
   * Without the reset below, a candidate who spent their retake budget
   * earning a badge could never recover it once that badge expires — on
   * FREE tier (retakesPerSkillLifetime: 1) this is guaranteed to happen to
   * anyone who failed once before passing: their 2 lifetime attempts at
   * this level are both already spent the moment they earn the badge, a
   * year before it even lapses. Once the most recently expired
   * (non-revoked) badge for this exact skill+level is found, only attempts
   * *after* that badge's own expiresAt count toward the cap — each lapse
   * opens exactly one fresh window, not a permanently growing exemption if
   * a candidate lets several badges expire over time.
   */
  async checkRetakeEligibility(userId: string, skillId: string, level: SkillLevel): Promise<{ attemptNumber: number }> {
    const candidateId = await this.ensureProfileId(userId);
    const tier = await this.resolveEffectiveTierForProfile(candidateId);
    const { retakeCooldownDays, retakesPerSkillLifetime } = PLANS[tier];

    const priorAttempts = await this.prisma.attempt.findMany({
      where: { userId, status: AttemptStatus.GRADED, assessment: { skillId, targetLevel: level } },
      orderBy: { createdAt: 'desc' },
      select: { submittedAt: true, createdAt: true },
    });

    const priorCount = priorAttempts.length;
    const attemptNumber = priorCount + 1;
    if (priorCount === 0) return { attemptNumber };

    const mostRecentLapse = await this.prisma.badge.findFirst({
      where: { userId, skillId, level, revokedAt: null, expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });
    const attemptsSinceLapse = mostRecentLapse
      ? priorAttempts.filter((a) => a.createdAt > mostRecentLapse.expiresAt).length
      : priorCount;

    const totalAllowedAttempts = 1 + retakesPerSkillLifetime;
    if (attemptsSinceLapse >= totalAllowedAttempts) {
      throw new EntitlementLimitException('retakesPerSkillLifetime', retakesPerSkillLifetime, null);
    }

    if (retakeCooldownDays > 0) {
      const mostRecent = priorAttempts[0];
      const lastCompletedAt = mostRecent.submittedAt ?? mostRecent.createdAt;
      const cooldownEndsAt = new Date(lastCompletedAt.getTime() + retakeCooldownDays * 24 * 60 * 60 * 1000);
      if (new Date() < cooldownEndsAt) {
        throw new EntitlementLimitException('retakeCooldownDays', retakeCooldownDays, cooldownEndsAt);
      }
    }

    return { attemptNumber };
  }

  /**
   * Enforces singleSkillRestriction: a FREE candidate's self-serve MCQ
   * attempts (any level) are locked to one skill for life, set the first
   * time they start an attempt — see CandidateProfile.freeSkillLockId's own
   * doc comment in schema.prisma. No-op on any tier where
   * singleSkillRestriction is false (PREMIUM today) and for a candidate
   * grandfathered via freeSkillLockExempt (set only by the one-time
   * backfill migration for candidates who already had attempts across
   * multiple skills before this restriction shipped).
   *
   * Deliberately keyed off freeSkillLockId, a plain lifetime fact on
   * CandidateProfile, not a CountableMetric/UsageCounter row — there's no
   * periodic reset here, and UsageCounter's (candidateId, metric,
   * periodStart) shape has nowhere to hold a skill id anyway. Called from
   * AssessmentsService.startAttempt's self-serve branch only —
   * employer-paid starts (skipLevelAndRetakeChecks) never reach this, same
   * as checkRetakeEligibility.
   *
   * Race-safety: two concurrent first attempts in different skills must
   * never both succeed in locking to different skills, the same concern
   * incrementBounded's own doc comment above walks through for monthly
   * counters. The claiming UPDATE below is a single `WHERE
   * "freeSkillLockId" IS NULL` statement — Postgres resolves which of two
   * simultaneous callers actually wins the row lock, so a loser here always
   * observes whatever the winner set, never a torn/duplicate lock.
   */
  async checkSkillLockEligibility(userId: string, skillId: string): Promise<void> {
    const candidateId = await this.ensureProfileId(userId);
    const tier = await this.resolveEffectiveTierForProfile(candidateId);
    if (!PLANS[tier].singleSkillRestriction) return;

    const profile = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: { freeSkillLockId: true, freeSkillLockExempt: true },
    });
    if (profile?.freeSkillLockExempt) return;
    if (profile?.freeSkillLockId === skillId) return;
    if (profile?.freeSkillLockId) {
      throw new EntitlementLimitException('singleSkillRestriction', null, null);
    }

    const claimed = await this.prisma.$queryRaw<{ freeSkillLockId: string }[]>`
      UPDATE "CandidateProfile"
      SET "freeSkillLockId" = ${skillId}, "freeSkillLockedAt" = now()
      WHERE id = ${candidateId} AND "freeSkillLockId" IS NULL
      RETURNING "freeSkillLockId"
    `;
    if (claimed.length === 1) return; // this call won the race, lock set to skillId

    // Lost the race to a concurrent first attempt — re-check what it locked to.
    const settled = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: { freeSkillLockId: true },
    });
    if (settled?.freeSkillLockId !== skillId) {
      throw new EntitlementLimitException('singleSkillRestriction', null, null);
    }
  }

  /** Public wrapper for callers outside this module that need just the tier — e.g. ProfileViewsService's display gate. */
  async getEffectiveTier(userId: string): Promise<SubscriptionTier> {
    const candidateId = await this.ensureProfileId(userId);
    return this.resolveEffectiveTierForProfile(candidateId);
  }

  /**
   * Batch tier resolution for ranking many candidates at once (see
   * scoring.ts's searchRankBoost / MatchingService.getMatches) — one query
   * for every candidate's Subscription row instead of N.
   */
  async resolveEffectiveTiersForCandidates(candidateProfileIds: string[]): Promise<Map<string, SubscriptionTier>> {
    if (candidateProfileIds.length === 0) return new Map();

    const subscriptions = await this.prisma.subscription.findMany({
      where: { candidateId: { in: candidateProfileIds } },
    });
    const byCandidateId = new Map(subscriptions.map((s) => [s.candidateId, s]));

    const result = new Map<string, SubscriptionTier>();
    for (const id of candidateProfileIds) {
      result.set(id, resolveEffectiveTier(byCandidateId.get(id) ?? null));
    }
    return result;
  }

  /**
   * Admin-only manual tier assignment (foundation work — no payment
   * provider exists yet). Upserts rather than requiring a row to already
   * exist, since this is the one deliberate, explicit write that's allowed
   * to create a Subscription row for a candidate who's never had one —
   * distinct from the "never backfill" rule, which is about not
   * *proactively* creating rows for every existing candidate.
   */
  async setTierManually(
    candidateProfileId: string,
    tier: SubscriptionTier,
    status: SubscriptionStatus,
    currentPeriodEnd: Date | null,
    cancelAtPeriodEnd: boolean,
  ): Promise<Subscription> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { id: candidateProfileId } });
    if (!profile) throw new NotFoundException('Candidate profile not found');

    return this.prisma.subscription.upsert({
      where: { candidateId: candidateProfileId },
      update: { tier, status, currentPeriodEnd, cancelAtPeriodEnd },
      create: { candidateId: candidateProfileId, tier, status, currentPeriodEnd, cancelAtPeriodEnd },
    });
  }

  private async readUsage(candidateId: string, metric: CountableMetric, limit: number | null): Promise<UsageEntry> {
    const now = new Date();
    const periodStart = periodStartOf(now);
    const row = await this.prisma.usageCounter.findUnique({
      where: { candidateId_metric_periodStart: { candidateId, metric, periodStart } },
    });
    return { used: row?.count ?? 0, limit, resetsAt: nextPeriodStartOf(now) };
  }

  /**
   * Single atomic INSERT ... ON CONFLICT DO UPDATE ... WHERE, bounded by
   * `limit` (null = unlimited, never blocks). Inserts a fresh count=1 row
   * on first use of the period; otherwise increments the existing row only
   * if it's still under `limit` — Postgres evaluates the WHERE clause and
   * applies (or skips) the UPDATE atomically under the row's own lock, so
   * this is safe under concurrent requests without any surrounding
   * multi-statement transaction (see checkAndIncrement's own doc comment
   * for why an earlier two-statement version of this was unsafe). Returns
   * a row (with the new count) only when the write actually took effect;
   * an empty result means the existing row was already at/above `limit`.
   */
  private async incrementBounded(
    candidateId: string,
    metric: string,
    periodStart: Date,
    limit: number | null,
  ): Promise<number> {
    const rows =
      limit === null
        ? await this.prisma.$queryRaw<{ count: number }[]>`
            INSERT INTO "UsageCounter" ("id", "candidateId", "metric", "periodStart", "count", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::text, ${candidateId}, ${metric}, ${periodStart}, 1, now(), now())
            ON CONFLICT ("candidateId", "metric", "periodStart")
            DO UPDATE SET "count" = "UsageCounter"."count" + 1, "updatedAt" = now()
            RETURNING "count"
          `
        : await this.prisma.$queryRaw<{ count: number }[]>`
            INSERT INTO "UsageCounter" ("id", "candidateId", "metric", "periodStart", "count", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::text, ${candidateId}, ${metric}, ${periodStart}, 1, now(), now())
            ON CONFLICT ("candidateId", "metric", "periodStart")
            DO UPDATE SET "count" = "UsageCounter"."count" + 1, "updatedAt" = now()
            WHERE "UsageCounter"."count" < ${limit}
            RETURNING "count"
          `;

    if (rows.length === 1) return rows[0].count;
    throw new EntitlementLimitException(metric, limit, nextPeriodStartOf(periodStart));
  }

  private async resolveEffectiveTierForProfile(candidateId: string): Promise<SubscriptionTier> {
    const subscription = await this.prisma.subscription.findUnique({ where: { candidateId } });
    return resolveEffectiveTier(subscription);
  }

  /** Same ensureProfile-on-first-use pattern used throughout this codebase (e.g. CertificationsService, CandidateJobsService). */
  private async ensureProfileId(userId: string): Promise<string> {
    const existing = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.candidateProfile.create({ data: { userId }, select: { id: true } });
    return created.id;
  }
}
