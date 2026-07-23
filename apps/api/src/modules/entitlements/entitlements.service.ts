import { Injectable, NotFoundException } from '@nestjs/common';
import { AttemptStatus, Subscription, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS } from '../../config/plans.config';
import { BooleanFeature, CountableMetric } from './requires-entitlement.decorator';
import { EntitlementLimitException } from './entitlements.errors';

/** PAST_DUE keeps PREMIUM entitlements for this many days after currentPeriodEnd — see resolveEffectiveTier. */
const PAST_DUE_GRACE_DAYS = 7;

const METRIC_LIMIT_KEY: Record<CountableMetric, 'assessmentsPerMonth' | 'applicationsPerMonth'> = {
  assessments: 'assessmentsPerMonth',
  applications: 'applicationsPerMonth',
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
  };
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

    const [assessments, applications] = await Promise.all([
      this.readUsage(candidateId, 'assessments', limits.assessmentsPerMonth),
      this.readUsage(candidateId, 'applications', limits.applicationsPerMonth),
    ]);

    return { tier, limits, usage: { assessments, applications } };
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
   * "Prior attempts" = this user's GRADED attempts across every assessment
   * for this skill (any level) — CREATED/IN_PROGRESS attempts don't count
   * (nothing to retake yet), and a skill's very first attempt is never
   * gated by either rule regardless of tier. Scoped to skill, not
   * skill+level, per this feature's own spec: a candidate's retake budget
   * is shared across a skill's whole ladder, not reset per level.
   */
  async checkRetakeEligibility(userId: string, skillId: string): Promise<{ attemptNumber: number }> {
    const candidateId = await this.ensureProfileId(userId);
    const tier = await this.resolveEffectiveTierForProfile(candidateId);
    const { retakeCooldownDays, retakesPerSkillLifetime } = PLANS[tier];

    const priorAttempts = await this.prisma.attempt.findMany({
      where: { userId, status: AttemptStatus.GRADED, assessment: { skillId } },
      orderBy: { createdAt: 'desc' },
      select: { submittedAt: true, createdAt: true },
    });

    const priorCount = priorAttempts.length;
    const attemptNumber = priorCount + 1;
    if (priorCount === 0) return { attemptNumber };

    const totalAllowedAttempts = 1 + retakesPerSkillLifetime;
    if (priorCount >= totalAllowedAttempts) {
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
