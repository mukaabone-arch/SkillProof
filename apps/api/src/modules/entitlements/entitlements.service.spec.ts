import { AttemptStatus, Subscription, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { EntitlementsService, periodStartOf, nextPeriodStartOf, resolveEffectiveTier } from './entitlements.service';
import { EntitlementLimitException } from './entitlements.errors';

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

  const prisma: Record<string, any> = {
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

  return { prisma, usageCounterRows, attempts };
}

describe('EntitlementsService.checkAndIncrement', () => {
  it('increments under the limit and returns the running count', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    const first = await svc.checkAndIncrement('user-1', 'assessments');
    expect(first.used).toBe(1);
    expect(first.limit).toBe(2); // FREE.assessmentsPerMonth

    const second = await svc.checkAndIncrement('user-1', 'assessments');
    expect(second.used).toBe(2);
  });

  it('throws EntitlementLimitException once the limit is reached', async () => {
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await svc.checkAndIncrement('user-1', 'assessments');
    await svc.checkAndIncrement('user-1', 'assessments'); // now at limit=2

    await expect(svc.checkAndIncrement('user-1', 'assessments')).rejects.toThrow(EntitlementLimitException);
    try {
      await svc.checkAndIncrement('user-1', 'assessments');
      fail('expected EntitlementLimitException');
    } catch (err) {
      expect(err).toBeInstanceOf(EntitlementLimitException);
      const response = (err as EntitlementLimitException).getResponse() as Record<string, unknown>;
      expect(response.code).toBe('LIMIT_REACHED');
      expect(response.metric).toBe('assessments');
      expect(response.limit).toBe(2);
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

  it('resolves the tier server-side from the Subscription row, never from a client-supplied value', async () => {
    // There is no parameter anywhere on checkAndIncrement for a caller to pass
    // a tier — this test documents that guarantee at the type level: the only
    // way tier can vary is through what Subscription.findUnique returns.
    const { prisma } = fakePrisma();
    prisma.subscription.findUnique.mockResolvedValue(null); // no row → FREE
    const svc = new EntitlementsService(prisma as any);

    const result = await svc.checkAndIncrement('user-1', 'assessments');
    expect(result.limit).toBe(2); // FREE's limit, even though nothing told it to be FREE explicitly
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

  it('FREE: a retake within the 60-day cooldown is blocked with metric retakeCooldownDays', async () => {
    const { prisma, attempts } = fakePrisma();
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 10 }]); // one prior attempt, 10 days ago
    prisma.subscription.findUnique.mockResolvedValue(
      fakeSubscription({ tier: SubscriptionTier.FREE, status: SubscriptionStatus.ACTIVE }),
    );
    const svc = new EntitlementsService(prisma as any);

    await expect(svc.checkRetakeEligibility('user-1', 'skill-1')).rejects.toMatchObject({
      response: { code: 'LIMIT_REACHED', metric: 'retakeCooldownDays', limit: 60 },
    });
  });

  it('FREE: a retake after the 60-day cooldown has elapsed succeeds as attempt #2', async () => {
    const { prisma, attempts } = fakePrisma();
    withAttempts(attempts, 'user-1', 'skill-1', [{ daysAgo: 61 }]);
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
