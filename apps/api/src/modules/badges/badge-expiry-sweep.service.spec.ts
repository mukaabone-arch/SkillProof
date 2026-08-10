import { Badge, ClaimStatus, SkillLevel, BadgeVerificationMethod } from '@prisma/client';
import { BadgeResolverService } from './badge-resolver.service';
import { BadgeExpirySweepService } from './badge-expiry-sweep.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function fakeBadge(overrides: Partial<Badge>): Badge {
  return {
    id: 'badge-1',
    userId: 'user-1',
    skillId: 'skill-1',
    level: SkillLevel.L2,
    verifiedBy: BadgeVerificationMethod.TEST,
    verifyHash: 'hash',
    issuedAt: new Date(Date.now() - 400 * DAY_MS),
    expiresAt: new Date(Date.now() + 300 * DAY_MS),
    revokedAt: null,
    attemptNumber: 1,
    ...overrides,
  } as Badge;
}

/**
 * Minimal Prisma stub. resolveLevelMap reads badge.findMany with an
 * `expiresAt: { gt: now }` clause when excluding expired badges — the stub
 * honours that clause against the seeded rows so an expired badge really is
 * absent from resolution, exactly as the DB would return it.
 */
function fakePrisma(seed: { badges?: Badge[]; claim?: any; profileId?: string | null } = {}) {
  const badges = seed.badges ?? [];
  let claim = seed.claim ?? null;
  const prisma: Record<string, any> = {
    badge: {
      findMany: jest.fn(async ({ where }: any) =>
        badges.filter((b) => {
          if (b.userId !== where.userId || b.skillId !== where.skillId || b.revokedAt !== null) return false;
          if (where.expiresAt?.gt && !(b.expiresAt.getTime() > where.expiresAt.gt.getTime())) return false;
          return true;
        }),
      ),
    },
    candidateProfile: {
      findUnique: jest.fn(async () =>
        seed.profileId === null ? null : { id: seed.profileId ?? 'profile-1' },
      ),
    },
    skillClaim: {
      findUnique: jest.fn(async () => claim),
      update: jest.fn(async ({ data }: any) => {
        claim = { ...claim, ...data };
        return claim;
      }),
      upsert: jest.fn(async ({ create, update }: any) => {
        claim = claim ? { ...claim, ...update } : { id: 'claim-1', ...create };
        return claim;
      }),
    },
  };
  return { prisma, getClaim: () => claim };
}

describe('BadgeResolverService.syncSkillClaim — expiry demotion', () => {
  it('demotes a VERIFIED claim to EXPIRED when the only backing badge has lapsed', async () => {
    const { prisma, getClaim } = fakePrisma({
      badges: [fakeBadge({ expiresAt: new Date(Date.now() - 1 * DAY_MS) })], // expired yesterday
      claim: { id: 'claim-1', status: ClaimStatus.VERIFIED, level: SkillLevel.L2, badgeId: 'badge-1' },
    });
    const resolver = new BadgeResolverService(prisma as any);

    await resolver.syncSkillClaim('user-1', 'skill-1');

    expect(prisma.skillClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: ClaimStatus.EXPIRED } }),
    );
    // level/badgeId deliberately left pointing at the last-held badge.
    expect(getClaim()).toMatchObject({ status: ClaimStatus.EXPIRED, level: SkillLevel.L2, badgeId: 'badge-1' });
  });

  it('leaves an already-EXPIRED claim untouched (no redundant write)', async () => {
    const { prisma } = fakePrisma({
      badges: [fakeBadge({ expiresAt: new Date(Date.now() - 1 * DAY_MS) })],
      claim: { id: 'claim-1', status: ClaimStatus.EXPIRED, level: SkillLevel.L2, badgeId: 'badge-1' },
    });
    const resolver = new BadgeResolverService(prisma as any);

    await resolver.syncSkillClaim('user-1', 'skill-1');

    expect(prisma.skillClaim.update).not.toHaveBeenCalled();
  });

  it('does not demote when a still-valid badge for the same skill re-resolves the claim', async () => {
    const { prisma } = fakePrisma({
      badges: [
        fakeBadge({ id: 'old', expiresAt: new Date(Date.now() - 1 * DAY_MS) }), // lapsed
        fakeBadge({ id: 'fresh', expiresAt: new Date(Date.now() + 200 * DAY_MS) }), // still valid
      ],
      claim: { id: 'claim-1', status: ClaimStatus.VERIFIED, level: SkillLevel.L2, badgeId: 'old' },
    });
    const resolver = new BadgeResolverService(prisma as any);

    await resolver.syncSkillClaim('user-1', 'skill-1');

    expect(prisma.skillClaim.update).not.toHaveBeenCalled();
    expect(prisma.skillClaim.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: ClaimStatus.VERIFIED, badgeId: 'fresh' }) }),
    );
  });

  it('never creates a claim from nothing — no profile means it no-ops entirely', async () => {
    const { prisma } = fakePrisma({ profileId: null });
    const resolver = new BadgeResolverService(prisma as any);

    await resolver.syncSkillClaim('user-1', 'skill-1');

    expect(prisma.skillClaim.findUnique).not.toHaveBeenCalled();
    expect(prisma.skillClaim.update).not.toHaveBeenCalled();
    expect(prisma.skillClaim.upsert).not.toHaveBeenCalled();
  });
});

describe('BadgeExpirySweepService.sweep', () => {
  function sweepPrisma(staleClaims: { userId: string; skillId: string }[]) {
    return {
      skillClaim: {
        findMany: jest.fn(async () =>
          staleClaims.map((c) => ({ profile: { userId: c.userId }, skillId: c.skillId })),
        ),
      },
    } as Record<string, any>;
  }

  it('re-syncs every stale VERIFIED-but-expired claim and reports the count', async () => {
    const prisma = sweepPrisma([
      { userId: 'user-1', skillId: 'skill-1' },
      { userId: 'user-2', skillId: 'skill-9' },
    ]);
    const resolver = { syncSkillClaim: jest.fn(async () => undefined) } as unknown as BadgeResolverService;
    const svc = new BadgeExpirySweepService(prisma as any, resolver);

    const { reevaluated } = await svc.sweep();

    expect(reevaluated).toBe(2);
    expect(resolver.syncSkillClaim).toHaveBeenCalledWith('user-1', 'skill-1');
    expect(resolver.syncSkillClaim).toHaveBeenCalledWith('user-2', 'skill-9');
  });

  it('is a no-op returning 0 when nothing has lapsed', async () => {
    const prisma = sweepPrisma([]);
    const resolver = { syncSkillClaim: jest.fn() } as unknown as BadgeResolverService;
    const svc = new BadgeExpirySweepService(prisma as any, resolver);

    const { reevaluated } = await svc.sweep();

    expect(reevaluated).toBe(0);
    expect(resolver.syncSkillClaim).not.toHaveBeenCalled();
  });
});
