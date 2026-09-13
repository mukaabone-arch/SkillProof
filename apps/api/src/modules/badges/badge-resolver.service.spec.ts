import { Badge, SkillLevel } from '@prisma/client';
import { badgeExpiresAt, BADGE_VALIDITY_YEARS, BadgeResolverService, deriveLevelStates } from './badge-resolver.service';

/** Only truthiness of a levelMap entry matters to deriveLevelStates — a minimal stub is enough. */
function fakeBadge(): Badge {
  return { id: 'badge' } as Badge;
}

const { L1, L2, L3, L4 } = SkillLevel;
const ALL_LEVELS = [L1, L2, L3, L4];

describe('deriveLevelStates', () => {
  it('fresh candidate: only the first offered level is AVAILABLE, the rest LOCKED', () => {
    const states = deriveLevelStates(ALL_LEVELS, {});
    expect(states.get(L1)).toBe('AVAILABLE');
    expect(states.get(L2)).toBe('LOCKED');
    expect(states.get(L3)).toBe('LOCKED');
    expect(states.get(L4)).toBe('LOCKED');
  });

  it('in-order progress: L1 earned unlocks L2, L3/L4 stay LOCKED', () => {
    const states = deriveLevelStates(ALL_LEVELS, { [L1]: fakeBadge() });
    expect(states.get(L1)).toBe('EARNED');
    expect(states.get(L2)).toBe('AVAILABLE');
    expect(states.get(L3)).toBe('LOCKED');
    expect(states.get(L4)).toBe('LOCKED');
  });

  it('grandfathered L2-without-L1: L1 is SUBSUMED (never revoked or re-required), L2 stays EARNED, L3 unlocks', () => {
    const states = deriveLevelStates(ALL_LEVELS, { [L2]: fakeBadge() });
    expect(states.get(L1)).toBe('SUBSUMED');
    expect(states.get(L2)).toBe('EARNED');
    expect(states.get(L3)).toBe('AVAILABLE');
    expect(states.get(L4)).toBe('LOCKED');
  });

  it('all-earned: every offered level is EARNED, none AVAILABLE', () => {
    const states = deriveLevelStates(ALL_LEVELS, {
      [L1]: fakeBadge(),
      [L2]: fakeBadge(),
      [L3]: fakeBadge(),
      [L4]: fakeBadge(),
    });
    expect(states.get(L1)).toBe('EARNED');
    expect(states.get(L2)).toBe('EARNED');
    expect(states.get(L3)).toBe('EARNED');
    expect(states.get(L4)).toBe('EARNED');
    expect([...states.values()]).not.toContain('AVAILABLE');
  });

  it('a skill offering only a single level (e.g. RAG Systems L2 today) has that level AVAILABLE to a fresh candidate — no phantom L1 gate', () => {
    const states = deriveLevelStates([L2], {});
    expect(states.get(L2)).toBe('AVAILABLE');
  });
});

describe('badgeExpiresAt', () => {
  it('lands on the same calendar date BADGE_VALIDITY_YEARS out, not a fixed millisecond offset', () => {
    const issuedAt = new Date('2026-08-10T12:00:00.000Z');
    const expiry = badgeExpiresAt(issuedAt);
    expect(expiry.getFullYear()).toBe(issuedAt.getFullYear() + BADGE_VALIDITY_YEARS);
    expect(expiry.getMonth()).toBe(issuedAt.getMonth());
    expect(expiry.getDate()).toBe(issuedAt.getDate());
  });

  it('does not mutate the passed issuedAt', () => {
    const issuedAt = new Date('2026-08-10T12:00:00.000Z');
    const before = issuedAt.getTime();
    badgeExpiresAt(issuedAt);
    expect(issuedAt.getTime()).toBe(before);
  });

  it('a Feb-29 issuance lands on a real calendar date a year out (setFullYear normalises, never NaN)', () => {
    const leapDay = new Date('2028-02-29T09:00:00.000Z');
    const expiry = badgeExpiresAt(leapDay);
    expect(Number.isNaN(expiry.getTime())).toBe(false);
    expect(expiry.getFullYear()).toBe(2029);
  });
});

const GATE_LEVELS = [L1, L2, L3];
const FUTURE = new Date('2099-01-01T00:00:00.000Z');
const PAST = new Date('2020-01-01T00:00:00.000Z');

/** Minimal fake Prisma — just enough surface for resolveApplyGateProgress's own logic. */
function fakeGatePrisma(opts: {
  freeSkillLockId?: string | null;
  badges?: Array<{ skillId: string; skillName: string; level: SkillLevel; revokedAt?: Date | null; expiresAt?: Date; issuedAt?: Date }>;
  offeredLevelsBySkill?: Record<string, SkillLevel[]>;
}) {
  const badges = opts.badges ?? [];
  const offeredLevelsBySkill = opts.offeredLevelsBySkill ?? {};
  return {
    candidateProfile: {
      findUnique: jest.fn(async () => ('freeSkillLockId' in opts ? { freeSkillLockId: opts.freeSkillLockId } : null)),
    },
    skill: {
      findUniqueOrThrow: jest.fn(async ({ where }: any) => ({ id: where.id, name: `skill-${where.id}` })),
    },
    assessment: {
      findMany: jest.fn(async ({ where }: any) =>
        (offeredLevelsBySkill[where.skillId] ?? []).map((targetLevel) => ({ targetLevel })),
      ),
    },
    badge: {
      // Mirrors the real query's WHERE clause server-side filtering
      // (level IN levels, revokedAt: null, expiresAt: { gt: now }) —
      // rows that wouldn't survive that clause never reach the fake either.
      findMany: jest.fn(async ({ where }: any) => {
        const now = new Date();
        return badges
          .filter((b) => where.level.in.includes(b.level))
          .filter((b) => (b.revokedAt ?? null) === null)
          .filter((b) => (b.expiresAt ?? FUTURE) > now)
          .map((b) => ({ skillId: b.skillId, level: b.level, issuedAt: b.issuedAt ?? PAST, skill: { name: b.skillName } }));
      }),
    },
  };
}

describe('BadgeResolverService.resolveApplyGateProgress', () => {
  it('met: false, progress: null for a candidate with no relevant badges at all', async () => {
    const svc = new BadgeResolverService(fakeGatePrisma({ badges: [] }) as any);
    const result = await svc.resolveApplyGateProgress('user-1', GATE_LEVELS);
    expect(result).toEqual({ met: false, progress: null });
  });

  it('met: true when one skill currently holds valid badges at all three required levels', async () => {
    const svc = new BadgeResolverService(
      fakeGatePrisma({
        badges: [
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L1, expiresAt: FUTURE },
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L2, expiresAt: FUTURE },
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L3, expiresAt: FUTURE },
        ],
      }) as any,
    );
    const result = await svc.resolveApplyGateProgress('user-1', GATE_LEVELS);
    expect(result.met).toBe(true);
    expect(result.progress).toEqual({
      skillId: 'skill-a',
      skillName: 'LLM Evaluation',
      levelsHeld: [L1, L2, L3],
      levelsRemaining: [],
    });
  });

  it('met: false with partial progress for the skill closest to complete, when no single skill has all three', async () => {
    const svc = new BadgeResolverService(
      fakeGatePrisma({
        badges: [
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L1, expiresAt: FUTURE },
          { skillId: 'skill-b', skillName: 'RAG Systems', level: L1, expiresAt: FUTURE },
          { skillId: 'skill-b', skillName: 'RAG Systems', level: L2, expiresAt: FUTURE },
        ],
      }) as any,
    );
    const result = await svc.resolveApplyGateProgress('user-1', GATE_LEVELS);
    expect(result.met).toBe(false);
    // skill-b holds 2 of 3 levels, more than skill-a's 1 — that's the one surfaced.
    expect(result.progress).toEqual({
      skillId: 'skill-b',
      skillName: 'RAG Systems',
      levelsHeld: [L1, L2],
      levelsRemaining: [L3],
    });
  });

  it('excludes an expired badge — a lapsed level does not count as currently held', async () => {
    const svc = new BadgeResolverService(
      fakeGatePrisma({
        badges: [
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L1, expiresAt: PAST },
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L2, expiresAt: FUTURE },
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L3, expiresAt: FUTURE },
        ],
      }) as any,
    );
    const result = await svc.resolveApplyGateProgress('user-1', GATE_LEVELS);
    expect(result.met).toBe(false);
    expect(result.progress?.levelsHeld).toEqual([L2, L3]);
  });

  it('excludes a revoked badge even if not yet expired', async () => {
    const svc = new BadgeResolverService(
      fakeGatePrisma({
        badges: [
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L1, expiresAt: FUTURE, revokedAt: new Date() },
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L2, expiresAt: FUTURE },
          { skillId: 'skill-a', skillName: 'LLM Evaluation', level: L3, expiresAt: FUTURE },
        ],
      }) as any,
    );
    const result = await svc.resolveApplyGateProgress('user-1', GATE_LEVELS);
    expect(result.met).toBe(false);
  });

  it('exempts a free-skill-locked candidate whose locked skill cannot offer all required levels (e.g. discussion-only L2)', async () => {
    const svc = new BadgeResolverService(
      fakeGatePrisma({
        freeSkillLockId: 'rag-systems',
        offeredLevelsBySkill: { 'rag-systems': [L2] },
        badges: [],
      }) as any,
    );
    const result = await svc.resolveApplyGateProgress('user-1', GATE_LEVELS);
    expect(result).toEqual({ met: true, progress: null });
  });

  it('does not exempt a free-skill-locked candidate whose locked skill actually offers all required levels', async () => {
    const svc = new BadgeResolverService(
      fakeGatePrisma({
        freeSkillLockId: 'skill-a',
        offeredLevelsBySkill: { 'skill-a': [L1, L2, L3] },
        badges: [],
      }) as any,
    );
    const result = await svc.resolveApplyGateProgress('user-1', GATE_LEVELS);
    expect(result).toEqual({ met: false, progress: null });
  });
});
