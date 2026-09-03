import { AttemptStatus, Subscription, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { EntitlementsService, periodStartOf, nextPeriodStartOf, resolveEffectiveTier } from './entitlements.service';
import { EntitlementLimitException } from './entitlements.errors';
import { AI_DISCUSSION_PROMO_LAUNCH_DATE, isAiDiscussionPromoActive } from '../../config/plans.config';

const DAY_MS = 24 * 60 * 60 * 1000;

function fakeSubscription(overrides: Partial<Subscription>): Subscription {
  return {
    id: 'sub-1',
    candidateId: 'candidate-1',
    tier: SubscriptionTier.PREMIUM,
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodEnd: null,
    provider: null,
    providerSubId: null,
    providerPlanId: null,
    lastWebhookEventAt: null,
    cancelAtPeriodEnd: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('resolveEffectiveTier', () => {
  it('no Subscription row → FREE', () => {
    expect(resolveEffectiveTier(null)).toBe(SubscriptionTier.FREE);
  });

  it('ACTIVE returns whatever tier is set', () => {
    expect(resolveEffectiveTier(fakeSubscription({ status: SubscriptionStatus.ACTIVE, tier: SubscriptionTier.FREE }))).toBe(
      SubscriptionTier.FREE,
    );
    expect(
      resolveEffectiveTier(fakeSubscription({ status: SubscriptionStatus.ACTIVE, tier: SubscriptionTier.PREMIUM })),
    ).toBe(SubscriptionTier.PREMIUM);
  });

  it('CANCELED is always FREE, even if tier is PREMIUM', () => {
    expect(
      resolveEffectiveTier(fakeSubscription({ status: SubscriptionStatus.CANCELED, tier: SubscriptionTier.PREMIUM })),
    ).toBe(SubscriptionTier.FREE);
  });

  it('EXPIRED is always FREE, even if tier is PREMIUM', () => {
    expect(
      resolveEffectiveTier(fakeSubscription({ status: SubscriptionStatus.EXPIRED, tier: SubscriptionTier.PREMIUM })),
    ).toBe(SubscriptionTier.FREE);
  });

  it('PAST_DUE + PREMIUM within the 7-day grace window (anchored on currentPeriodEnd) stays PREMIUM', () => {
    const now = new Date('2026-03-10T00:00:00.000Z');
    const currentPeriodEnd = new Date('2026-03-05T00:00:00.000Z'); // 5 days before `now`
    const sub = fakeSubscription({ status: SubscriptionStatus.PAST_DUE, tier: SubscriptionTier.PREMIUM, currentPeriodEnd });
    expect(resolveEffectiveTier(sub, now)).toBe(SubscriptionTier.PREMIUM);
  });

  it('PAST_DUE + PREMIUM exactly at the 7-day boundary still counts as within grace', () => {
    const currentPeriodEnd = new Date('2026-03-01T00:00:00.000Z');
    const now = new Date(currentPeriodEnd.getTime() + 7 * DAY_MS);
    const sub = fakeSubscription({ status: SubscriptionStatus.PAST_DUE, tier: SubscriptionTier.PREMIUM, currentPeriodEnd });
    expect(resolveEffectiveTier(sub, now)).toBe(SubscriptionTier.PREMIUM);
  });

  it('PAST_DUE + PREMIUM past the 7-day grace window drops to FREE', () => {
    const currentPeriodEnd = new Date('2026-03-01T00:00:00.000Z');
    const now = new Date(currentPeriodEnd.getTime() + 7 * DAY_MS + 1000);
    const sub = fakeSubscription({ status: SubscriptionStatus.PAST_DUE, tier: SubscriptionTier.PREMIUM, currentPeriodEnd });
    expect(resolveEffectiveTier(sub, now)).toBe(SubscriptionTier.FREE);
  });

  it('PAST_DUE + PREMIUM with no currentPeriodEnd falls back to anchoring on updatedAt', () => {
    const updatedAt = new Date('2026-03-01T00:00:00.000Z');
    const withinGrace = new Date(updatedAt.getTime() + 3 * DAY_MS);
    const pastGrace = new Date(updatedAt.getTime() + 8 * DAY_MS);
    const sub = fakeSubscription({
      status: SubscriptionStatus.PAST_DUE,
      tier: SubscriptionTier.PREMIUM,
      currentPeriodEnd: null,
      updatedAt,
    });
    expect(resolveEffectiveTier(sub, withinGrace)).toBe(SubscriptionTier.PREMIUM);
    expect(resolveEffectiveTier(sub, pastGrace)).toBe(SubscriptionTier.FREE);
  });

  it('PAST_DUE + FREE tier (defensive/nonsensical combo) is FREE regardless of grace window', () => {
    const sub = fakeSubscription({ status: SubscriptionStatus.PAST_DUE, tier: SubscriptionTier.FREE });
    expect(resolveEffectiveTier(sub)).toBe(SubscriptionTier.FREE);
  });
});

describe('periodStartOf / nextPeriodStartOf', () => {
  it('periodStartOf returns the first instant of the UTC calendar month', () => {
    const mid = new Date('2026-07-22T15:42:10.000Z');
    expect(periodStartOf(mid).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('nextPeriodStartOf returns the first instant of the following UTC calendar month', () => {
    const mid = new Date('2026-07-22T15:42:10.000Z');
    expect(nextPeriodStartOf(mid).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('nextPeriodStartOf wraps December into January of the next year', () => {
    const midDecember = new Date('2026-12-15T00:00:00.000Z');
    expect(nextPeriodStartOf(midDecember).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('periodStartOf is stable across any day within the same month', () => {
    expect(periodStartOf(new Date('2026-07-01T00:00:00.001Z'))).toEqual(periodStartOf(new Date('2026-07-31T23:59:59.999Z')));
  });
});

describe('isAiDiscussionPromoActive', () => {
  it('is true right at the launch instant', () => {
    expect(isAiDiscussionPromoActive(AI_DISCUSSION_PROMO_LAUNCH_DATE)).toBe(true);
  });

  it('is false one second before launch — the window has a lower bound, not just an upper one', () => {
    // Regression test for the original end-only implementation: without
    // checking `now >= launchDate`, deploying this code ahead of the
    // actual launch date would have let FREE candidates start getting
    // promotional discussion sessions early.
    const oneSecondBeforeLaunch = new Date(AI_DISCUSSION_PROMO_LAUNCH_DATE.getTime() - 1000);
    expect(isAiDiscussionPromoActive(oneSecondBeforeLaunch)).toBe(false);
  });

  it('is false well before launch', () => {
    expect(isAiDiscussionPromoActive(new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('is true one day before the 3-month cutoff', () => {
    const oneDayBeforeEnd = new Date('2026-11-23T00:00:00.000Z');
    expect(isAiDiscussionPromoActive(oneDayBeforeEnd)).toBe(true);
  });

  it('is false exactly at the 3-month cutoff — the window is a half-open [launch, launch+3mo) interval', () => {
    const exactCutoff = new Date('2026-11-24T00:00:00.000Z');
    expect(isAiDiscussionPromoActive(exactCutoff)).toBe(false);
  });

  it('is false one second after the cutoff', () => {
    const justAfter = new Date('2026-11-24T00:00:01.000Z');
    expect(isAiDiscussionPromoActive(justAfter)).toBe(false);
  });

  it('is false well after the cutoff', () => {
    expect(isAiDiscussionPromoActive(new Date('2027-06-01T00:00:00.000Z'))).toBe(false);
  });
});

/** Minimal PrismaService double — only the methods EntitlementsService actually calls. */
function fakePrisma() {
  const usageCounterRows = new Map<string, { candidateId: string; metric: string; periodStart: Date; count: number }>();
  const key = (candidateId: string, metric: string, periodStart: Date) =>
    `${candidateId}::${metric}::${periodStart.toISOString()}`;

  const usageCounter = {
    // Only used by refund() now — checkAndIncrement goes through $queryRaw below.
    updateMany: jest.fn(async ({ where, data }: any) => {
      const k = key(where.candidateId, where.metric, where.periodStart);
      const row = usageCounterRows.get(k);
      if (!row) return { count: 0 };
      if (where.count?.gt !== undefined && !(row.count > where.count.gt)) return { count: 0 };
      row.count += data.count.decrement !== undefined ? -data.count.decrement : data.count.increment;
      return { count: 1 };
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const k = key(where.candidateId_metric_periodStart.candidateId, where.candidateId_metric_periodStart.metric, where.candidateId_metric_periodStart.periodStart);
      return usageCounterRows.get(k) ?? null;
    }),
  };

  /**
   * Reproduces the real INSERT ... ON CONFLICT (...) DO UPDATE ... WHERE
   * statement's exact semantics (see EntitlementsService.incrementBounded):
   * a missing row always inserts at count=1 regardless of limit (the WHERE
   * only ever gates the UPDATE branch, never the INSERT branch); an
   * existing row increments only if still under limit, otherwise the query
   * returns zero rows and nothing is mutated.
   */
  const queryRaw = jest.fn(async (_strings: TemplateStringsArray, ...values: any[]) => {
    const [candidateId, metric, periodStart, limit] = values.length === 4 ? values : [...values, null];
    const k = key(candidateId, metric, periodStart);
    const existing = usageCounterRows.get(k);
    if (!existing) {
      usageCounterRows.set(k, { candidateId, metric, periodStart, count: 1 });
      return [{ count: 1 }];
    }
    if (limit !== null && !(existing.count < limit)) return [];
    existing.count += 1;
    return [{ count: existing.count }];
  });

  const attempts: { userId: string; status: AttemptStatus; skillId: string; submittedAt: Date | null; createdAt: Date }[] = [];

  // Non-revoked badges, used only by checkRetakeEligibility's most-recent-lapse
  // lookup. `expiresAt` in the future = still valid; in the past = lapsed.
  const badges: { userId: string; skillId: string; revokedAt: Date | null; expiresAt: Date }[] = [];

  const prisma: Record<string, any> = {
    badge: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const matches = badges
          .filter(
            (b) =>
              b.userId === where.userId &&
              b.skillId === where.skillId &&
              b.revokedAt === null &&
              b.expiresAt.getTime() <= where.expiresAt.lte.getTime(),
          )
          .sort((a, b) =>
            orderBy?.expiresAt === 'desc'
              ? b.expiresAt.getTime() - a.expiresAt.getTime()
              : a.expiresAt.getTime() - b.expiresAt.getTime(),
          );
        const first = matches[0];
        return first ? { expiresAt: first.expiresAt } : null;
      }),
    },
    candidateProfile: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.userId ? `profile-${where.userId}` : where.id })),
      create: jest.fn(async ({ data }: any) => ({ id: `profile-${data.userId}` })),
    },
    subscription: {
      findUnique: jest.fn(async () => null as Subscription | null),
      findMany: jest.fn(async () => [] as Subscription[]),
      upsert: jest.fn(),
    },
    usageCounter,
    $queryRaw: queryRaw,
    attempt: {
      findMany: jest.fn(async ({ where }: any) =>
        attempts
          .filter((a) => a.userId === where.userId && a.status === where.status && a.skillId === where.assessment.skillId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((a) => ({ submittedAt: a.submittedAt, createdAt: a.createdAt })),
      ),
    },
  };

  return { prisma, usageCounterRows, attempts, badges };
}

describe('EntitlementsService.checkAndIncrement', () => {
  // Exercised against 'applications' (FREE limit: 10, untouched by the
  // discussion-sessions change) rather than 'assessments' — assessmentsPerMonth
  // is now null (unlimited) on both tiers, so it can no longer stand in for
  // "a metric with a real, blockable limit" the way it used to. See the
  // dedicated 'never blocks assessments (unlimited on both tiers)' test
  // below for assessments' own new behavior, and the discussionSessions
  // block further down for the metric that actually has FREE-tier limits now.
  it('increments under the limit and returns the running count', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    const first = await svc.checkAndIncrement('user-1', 'applications');
    expect(first.used).toBe(1);
    expect(first.limit).toBe(10); // FREE.applicationsPerMonth

    const second = await svc.checkAndIncrement('user-1', 'applications');
    expect(second.used).toBe(2);
  });

  it('throws EntitlementLimitException once the limit is reached', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    for (let i = 0; i < 10; i++) await svc.checkAndIncrement('user-1', 'applications'); // now at limit=10

    await expect(svc.checkAndIncrement('user-1', 'applications')).rejects.toThrow(EntitlementLimitException);
    try {
      await svc.checkAndIncrement('user-1', 'applications');
      fail('expected EntitlementLimitException');
    } catch (err) {
      expect(err).toBeInstanceOf(EntitlementLimitException);
      const response = (err as EntitlementLimitException).getResponse() as Record<string, unknown>;
      expect(response.code).toBe('LIMIT_REACHED');
      expect(response.metric).toBe('applications');
      expect(response.limit).toBe(10);
      expect(response.resetsAt).toBeInstanceOf(Date);
    }
  });

  it('never blocks an unlimited (PREMIUM) metric, however many times it is called', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.PREMIUM, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    for (let i = 1; i <= 10; i++) {
      const result = await svc.checkAndIncrement('user-1', 'assessments');
      expect(result.used).toBe(i);
      expect(result.limit).toBeNull();
    }
  });

  it('never blocks assessments (MCQ) on FREE either — unlimited on both tiers as of the discussion-sessions split', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    for (let i = 1; i <= 5; i++) {
      const result = await svc.checkAndIncrement('user-1', 'assessments');
      expect(result.used).toBe(i);
      expect(result.limit).toBeNull();
    }
  });

  it('resolves the tier server-side from the Subscription row, never from a client-supplied value', async () => {
    // There is no parameter anywhere on checkAndIncrement for a caller to pass
    // a tier — this test documents that guarantee at the type level: the only
    // way tier can vary is through what Subscription.findUnique returns.
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(null); // no row → FREE
    const svc = new EntitlementsService(prisma as any);

    const result = await svc.checkAndIncrement('user-1', 'applications');
    expect(result.limit).toBe(10); // FREE's limit, even though nothing told it to be FREE explicitly
  });

  describe('discussionSessions (new metric — AI discussion sessions, distinct from MCQ assessments)', () => {
    afterEach(() => jest.useRealTimers());

    it('PREMIUM: 2/month, static — blocks on the 3rd', async () => {
      const { prisma } = fakePrisma();
      prisma.subscription.findUnique.mockResolvedValue(
        fakeSubscription({ tier: SubscriptionTier.PREMIUM, status: SubscriptionStatus.ACTIVE }),
      );
      const svc = new EntitlementsService(prisma as any);

      const first = await svc.checkAndIncrement('user-1', 'discussionSessions');
      expect(first).toMatchObject({ used: 1, limit: 2 });
      const second = await svc.checkAndIncrement('user-1', 'discussionSessions');
      expect(second).toMatchObject({ used: 2, limit: 2 });

      await expect(svc.checkAndIncrement('user-1', 'discussionSessions')).rejects.toMatchObject({
        response: { code: 'LIMIT_REACHED', metric: 'discussionSessions', limit: 2 },
      });
    });

    it('FREE, during the promo window: 1/month — blocks on the 2nd', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-15T00:00:00.000Z') }); // between launch and the 3-month cutoff
      const { prisma } = fakePrisma();
      prisma.subscription.findUnique.mockResolvedValue(
        fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
      );
      const svc = new EntitlementsService(prisma as any);

      const first = await svc.checkAndIncrement('user-1', 'discussionSessions');
      expect(first).toMatchObject({ used: 1, limit: 1 });

      await expect(svc.checkAndIncrement('user-1', 'discussionSessions')).rejects.toMatchObject({
        response: { code: 'LIMIT_REACHED', metric: 'discussionSessions', limit: 1 },
      });
    });

    it('FREE, after the promo window: 0/month — blocks the very first attempt of the month, not just the second', async () => {
      // Regression test for a real bug found while implementing this: the
      // atomic INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit in
      // incrementBounded only gates the UPDATE branch — a brand-new row's
      // first INSERT always succeeds regardless of `limit`, because there's
      // nothing to conflict with yet. Confirmed directly against Postgres
      // (not assumed) before adding checkAndIncrement's upfront
      // `limit <= 0` short-circuit. Without that guard, this exact test
      // would incorrectly pass on attempt #1.
      jest.useFakeTimers({ now: new Date('2026-12-01T00:00:00.000Z') }); // after the 3-month cutoff
      const { prisma } = fakePrisma();
      prisma.subscription.findUnique.mockResolvedValue(
        fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
      );
      const svc = new EntitlementsService(prisma as any);

      await expect(svc.checkAndIncrement('user-1', 'discussionSessions')).rejects.toMatchObject({
        response: { code: 'LIMIT_REACHED', metric: 'discussionSessions', limit: 0 },
      });
    });

    it('a limit: 0 breach never touches UsageCounter at all — no row is created', async () => {
      jest.useFakeTimers({ now: new Date('2026-12-01T00:00:00.000Z') });
      const { prisma, usageCounterRows } = fakePrisma();
      prisma.subscription.findUnique.mockResolvedValue(
        fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
      );
      const svc = new EntitlementsService(prisma as any);

      await expect(svc.checkAndIncrement('user-1', 'discussionSessions')).rejects.toThrow(EntitlementLimitException);
      expect(usageCounterRows.size).toBe(0);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});

describe('EntitlementsService.getEntitlements', () => {
  afterEach(() => jest.useRealTimers());

  it('reports all three countable metrics, including the new discussionSessions block', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-15T00:00:00.000Z') }); // during the promo window
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    const result = await svc.getEntitlements('user-1');
    expect(result.limits.assessmentsPerMonth).toBeNull(); // unlimited on both tiers now
    expect(result.limits.discussionSessionsPerMonth).toBe(1); // FREE, during the promo
    expect(result.usage.discussionSessions).toMatchObject({ used: 0, limit: 1 });
    expect(result.usage.assessments).toMatchObject({ used: 0, limit: null });
    expect(result.usage.applications).toMatchObject({ used: 0, limit: 10 });
  });

  it("reflects a FREE candidate's discussionSessionsPerMonth dropping to 0 once the promo ends, with no code change needed beyond the clock", async () => {
    jest.useFakeTimers({ now: new Date('2027-01-01T00:00:00.000Z') }); // well after the cutoff
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    const result = await svc.getEntitlements('user-1');
    expect(result.limits.discussionSessionsPerMonth).toBe(0);
    expect(result.usage.discussionSessions.limit).toBe(0);
  });
});

describe('EntitlementsService.checkRetakeEligibility', () => {
  function withAttempts(attempts: ReturnType<typeof fakePrisma>['attempts'], userId: string, skillId: string, entries: { daysAgo: number }[]) {
    const now = Date.now();
    for (const e of entries) {
      const at = new Date(now - e.daysAgo * DAY_MS);
      attempts.push({ userId, status: AttemptStatus.GRADED, skillId, submittedAt: at, createdAt: at });
    }
  }

  it('a skill\'s very first attempt is never gated, on any tier', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    const result = await svc.checkRetakeEligibility('user-1', 'skill-1');
    expect(result.attemptNumber).toBe(1);
  });

  it('FREE: retakeCooldownDays is 0, so a retake immediately after a prior attempt succeeds as attempt #2', async () => {
    const { prisma, attempts } = fakePrisma();
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 0 }]); // one prior attempt, today
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    const result = await svc.checkRetakeEligibility('user-1', 'skill-1');
    expect(result.attemptNumber).toBe(2);
  });

  it('FREE: a third attempt (2nd retake) is blocked by the lifetime cap regardless of cooldown', async () => {
    const { prisma, attempts } = fakePrisma();
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 200 }, { daysAgo: 100 }]); // 2 prior attempts, cooldown long since cleared
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkRetakeEligibility('user-1', 'skill-1')).rejects.toMatchObject({
      response: { code: 'LIMIT_REACHED', metric: 'retakesPerSkillLifetime', limit: 1, resetsAt: null },
    });
  });

  it('PREMIUM: retakes are immediately allowed (no cooldown) up to the 3-retake lifetime cap', async () => {
    const { prisma, attempts } = fakePrisma();
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 0 }, { daysAgo: 0 }, { daysAgo: 0 }]); // 3 prior attempts, all today
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.PREMIUM, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    const result = await svc.checkRetakeEligibility('user-1', 'skill-1');
    expect(result.attemptNumber).toBe(4); // 1 original + 3 retakes = 4th attempt, still within cap
  });

  it('PREMIUM: the 5th attempt (4th retake) is blocked by the lifetime cap', async () => {
    const { prisma, attempts } = fakePrisma();
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 0 }, { daysAgo: 0 }, { daysAgo: 0 }, { daysAgo: 0 }]);
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.PREMIUM, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkRetakeEligibility('user-1', 'skill-1')).rejects.toMatchObject({
      response: { code: 'LIMIT_REACHED', metric: 'retakesPerSkillLifetime', limit: 3, resetsAt: null },
    });
  });

  function withBadges(
    badges: ReturnType<typeof fakePrisma>['badges'],
    userId: string,
    skillId: string,
    entries: { expiresInDays: number; revoked?: boolean }[],
  ) {
    const now = Date.now();
    for (const e of entries) {
      badges.push({
        userId,
        skillId,
        revokedAt: e.revoked ? new Date() : null,
        expiresAt: new Date(now + e.expiresInDays * DAY_MS),
      });
    }
  }

  it('FREE: the lifetime cap that blocked a 3rd attempt is reset once the backing badge lapses — only attempts after the lapse count', async () => {
    const { prisma, attempts, badges } = fakePrisma();
    // Two prior attempts spent the FREE budget (1 original + 1 retake) and earned
    // a badge that has since expired 10 days ago. Both attempts predate the lapse.
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 400 }, { daysAgo: 380 }]);
    withBadges(badges, 'user-1', 'skill-1', [{ expiresInDays: -10 }]);
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    // Without the lapse reset this would throw the lifetime cap; instead the
    // window reopens and the renewal attempt is allowed as attempt #3.
    const result = await svc.checkRetakeEligibility('user-1', 'skill-1');
    expect(result.attemptNumber).toBe(3);
  });

  it('FREE: after a lapse, the fresh window itself still caps — an attempt made post-lapse counts toward the reopened budget', async () => {
    const { prisma, attempts, badges } = fakePrisma();
    // One attempt before the lapse, then two attempts after it: the post-lapse
    // window already holds original+retake, so a further retake is blocked again.
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 400 }, { daysAgo: 5 }, { daysAgo: 3 }]);
    withBadges(badges, 'user-1', 'skill-1', [{ expiresInDays: -10 }]);
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkRetakeEligibility('user-1', 'skill-1')).rejects.toMatchObject({
      response: { code: 'LIMIT_REACHED', metric: 'retakesPerSkillLifetime', limit: 1, resetsAt: null },
    });
  });

  it('a revoked badge past its expiresAt does NOT open a fresh window (revocation is not a lapse)', async () => {
    const { prisma, attempts, badges } = fakePrisma();
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 400 }, { daysAgo: 380 }]);
    withBadges(badges, 'user-1', 'skill-1', [{ expiresInDays: -10, revoked: true }]);
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkRetakeEligibility('user-1', 'skill-1')).rejects.toMatchObject({
      response: { code: 'LIMIT_REACHED', metric: 'retakesPerSkillLifetime', limit: 1, resetsAt: null },
    });
  });

  it('a still-valid badge (expiresAt in the future) is not a lapse — the lifetime cap applies unchanged', async () => {
    const { prisma, attempts, badges } = fakePrisma();
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 200 }, { daysAgo: 100 }]);
    withBadges(badges, 'user-1', 'skill-1', [{ expiresInDays: 300 }]);
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkRetakeEligibility('user-1', 'skill-1')).rejects.toMatchObject({
      response: { code: 'LIMIT_REACHED', metric: 'retakesPerSkillLifetime', limit: 1, resetsAt: null },
    });
  });
});

describe('EntitlementsService.refund', () => {
  it('decrements an existing count by exactly one', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.PREMIUM, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await svc.checkAndIncrement('user-1', 'assessments'); // used=1
    await svc.checkAndIncrement('user-1', 'assessments'); // used=2
    await svc.checkAndIncrement('user-1', 'assessments'); // used=3

    await svc.refund('user-1', 'assessments'); // used=2

    const entitlements = await svc.getEntitlements('user-1');
    expect(entitlements.usage.assessments.used).toBe(2);
  });

  it('never lets the counter go below zero, even with more refunds than charges', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await svc.checkAndIncrement('user-1', 'assessments'); // used=1
    await svc.refund('user-1', 'assessments'); // used=0
    await svc.refund('user-1', 'assessments'); // already 0 — must stay at 0, not go negative
    await svc.refund('user-1', 'assessments'); // same

    const entitlements = await svc.getEntitlements('user-1');
    expect(entitlements.usage.assessments.used).toBe(0);
  });

  it('refunding a metric/period that was never charged is a no-op, not an error', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.refund('user-1', 'assessments')).resolves.toBeUndefined();
    const entitlements = await svc.getEntitlements('user-1');
    expect(entitlements.usage.assessments.used).toBe(0);
  });

  it('a charge followed by a refund restores the exact prior usage (e.g. resuming an active attempt)', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await svc.checkAndIncrement('user-1', 'assessments'); // used=1
    await svc.checkAndIncrement('user-1', 'assessments'); // used=2 (at FREE's limit)
    await svc.refund('user-1', 'assessments'); // used=1 — the 2nd charge is undone

    const entitlements = await svc.getEntitlements('user-1');
    expect(entitlements.usage.assessments.used).toBe(1);

    // With the unit back, a genuinely new charge succeeds again.
    const result = await svc.checkAndIncrement('user-1', 'assessments');
    expect(result.used).toBe(2);
  });
});

describe('EntitlementsService.checkSkillLockEligibility', () => {
  /**
   * Dedicated fake, not the shared fakePrisma above — that one's $queryRaw
   * mock reproduces incrementBounded's INSERT ... ON CONFLICT shape
   * specifically (see its own doc comment), which is a different statement
   * from checkSkillLockEligibility's claiming UPDATE ... WHERE ... IS NULL.
   * Kept as one mutable `profile` object (not a Map) since every test here
   * only ever exercises a single candidate.
   */
  function fakeProfilePrisma(profile: { freeSkillLockId: string | null; freeSkillLockExempt: boolean }) {
    const state = { ...profile };
    const prisma: Record<string, any> = {
      candidateProfile: {
        findUnique: jest.fn(async () => ({ ...state })),
        create: jest.fn(async ({ data }: any) => ({ id: `profile-${data.userId}` })),
      },
      subscription: { findUnique: jest.fn(async () => null) },
      $queryRaw: jest.fn(async (_strings: TemplateStringsArray, ..._values: any[]) => {
        if (state.freeSkillLockId !== null) return [];
        state.freeSkillLockId = _values[0]; // the skillId being claimed
        return [{ freeSkillLockId: state.freeSkillLockId }];
      }),
    };
    return { prisma, state };
  }

  it('no-op on PREMIUM regardless of lock state — singleSkillRestriction is false there', async () => {
    const { prisma } = fakeProfilePrisma({ freeSkillLockId: null, freeSkillLockExempt: false });
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.PREMIUM, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkSkillLockEligibility('user-1', 'skill-a')).resolves.toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('FREE, no lock yet: the first self-serve attempt claims this skill as the lock', async () => {
    const { prisma, state } = fakeProfilePrisma({ freeSkillLockId: null, freeSkillLockExempt: false });
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkSkillLockEligibility('user-1', 'skill-a')).resolves.toBeUndefined();
    expect(state.freeSkillLockId).toBe('skill-a');
  });

  it('FREE, already locked to this same skill: repeat attempts in it are always allowed', async () => {
    const { prisma } = fakeProfilePrisma({ freeSkillLockId: 'skill-a', freeSkillLockExempt: false });
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkSkillLockEligibility('user-1', 'skill-a')).resolves.toBeUndefined();
  });

  it('FREE, locked to a different skill: blocked with metric singleSkillRestriction', async () => {
    const { prisma } = fakeProfilePrisma({ freeSkillLockId: 'skill-a', freeSkillLockExempt: false });
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkSkillLockEligibility('user-1', 'skill-b')).rejects.toMatchObject({
      response: { code: 'LIMIT_REACHED', metric: 'singleSkillRestriction', limit: null, resetsAt: null },
    });
  });

  it('FREE, grandfathered exempt: any skill is allowed, lock is never claimed', async () => {
    const { prisma, state } = fakeProfilePrisma({ freeSkillLockId: null, freeSkillLockExempt: true });
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkSkillLockEligibility('user-1', 'skill-a')).resolves.toBeUndefined();
    await expect(svc.checkSkillLockEligibility('user-1', 'skill-b')).resolves.toBeUndefined();
    expect(state.freeSkillLockId).toBeNull();
  });

  it('lost the claim race to a concurrent first attempt that locked a different skill: blocked', async () => {
    const { prisma, state } = fakeProfilePrisma({ freeSkillLockId: null, freeSkillLockExempt: false });
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    // Simulate a concurrent winner: the claiming UPDATE returns zero rows
    // (someone else's WHERE ... IS NULL already fired), and by the time this
    // call re-reads the profile, the lock is already set to a different skill.
    prisma.$queryRaw = jest.fn(async () => {
      state.freeSkillLockId = 'skill-a';
      return [];
    });
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkSkillLockEligibility('user-1', 'skill-b')).rejects.toMatchObject({
      response: { code: 'LIMIT_REACHED', metric: 'singleSkillRestriction' },
    });
  });
});
