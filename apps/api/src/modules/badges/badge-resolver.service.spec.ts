import { Badge, SkillLevel } from '@prisma/client';
import { badgeExpiresAt, BADGE_VALIDITY_YEARS, deriveLevelStates } from './badge-resolver.service';

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
