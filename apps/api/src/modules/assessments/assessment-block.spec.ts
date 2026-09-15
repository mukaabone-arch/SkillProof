import { IntegrityEventType } from '@prisma/client';
import { AssessmentsService } from './assessments.service';
import { AssessmentBlockedException } from './assessment-blocked.exception';

/**
 * Covers the 2026-09 24-hour integrity block: the trigger (maybeRaiseIntegrityBlock,
 * reached via addIntegrityEvent/recordIntegrityEvent) and the enforcement
 * (assertNotBlocked, reached via startAttempt). A small in-memory fake Prisma
 * — real enough to exercise the actual where-clauses this code issues, not a
 * hand-picked subset of behavior.
 */

interface FakeAttempt {
  id: string;
  userId: string;
  assessmentId: string;
  status: string;
  createdAt: Date;
  attemptNumber: number;
  integrityFlagCount: number;
  integrityStatus: string;
}

interface FakeAssessment {
  id: string;
  skillId: string;
  targetLevel: string;
  isLive: boolean;
  questionsPerAttempt: number;
}

interface FakeBlock {
  id: string;
  userId: string;
  skillId: string | null;
  startedAt: Date;
  expiresAt: Date;
  triggerAttemptIds: string[];
  reason: string;
  liftedAt: Date | null;
  liftedByUserId: string | null;
}

function makeFakeDb() {
  const assessments = new Map<string, FakeAssessment>();
  const attempts = new Map<string, FakeAttempt>();
  const integrityEvents: { attemptId: string; type: IntegrityEventType }[] = [];
  const blocks = new Map<string, FakeBlock>();
  let seq = 0;
  const nid = (p: string) => `${p}-${++seq}`;

  function registerAssessment(a: Partial<FakeAssessment> & { id: string }) {
    assessments.set(a.id, {
      skillId: 'skill-1',
      targetLevel: 'L1',
      isLive: true,
      questionsPerAttempt: 1,
      ...a,
    });
  }

  /** Inserts an attempt directly, bypassing startAttempt — for pre-existing history fixtures. */
  function seedAttempt(a: Partial<FakeAttempt> & { id: string; userId: string; assessmentId: string }) {
    const attempt: FakeAttempt = {
      status: 'GRADED',
      createdAt: new Date(),
      attemptNumber: 1,
      integrityFlagCount: 0,
      integrityStatus: 'CLEAN',
      ...a,
    };
    attempts.set(attempt.id, attempt);
    return attempt;
  }

  function seedIntegrityEvents(attemptId: string, type: IntegrityEventType, count: number) {
    for (let i = 0; i < count; i++) integrityEvents.push({ attemptId, type });
  }

  const prisma = {
    assessment: {
      findUnique: jest.fn(async ({ where }: any) => assessments.get(where.id) ?? null),
    },
    candidateProfile: {
      findUnique: jest.fn(async () => ({ fullName: 'Test Candidate', headline: 'Engineer', yearsOfExp: null })),
    },
    attempt: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const a of attempts.values()) {
          if (a.userId === where.userId && a.assessmentId === where.assessmentId && where.status.in.includes(a.status)) return a;
        }
        return null;
      }),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => {
        const attempt: FakeAttempt = {
          id: nid('attempt'),
          userId: data.userId,
          assessmentId: data.assessmentId,
          status: data.status,
          createdAt: new Date(),
          attemptNumber: data.attemptNumber,
          integrityFlagCount: 0,
          integrityStatus: 'CLEAN',
        };
        attempts.set(attempt.id, attempt);
        return attempt;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const a = attempts.get(where.id)!;
        if (data.integrityFlagCount?.increment) a.integrityFlagCount += data.integrityFlagCount.increment;
        if (data.integrityStatus) a.integrityStatus = data.integrityStatus;
        return a;
      }),
      findUnique: jest.fn(async ({ where, select }: any) => {
        const a = attempts.get(where.id);
        if (!a) return null;
        if (select?.assessment) {
          return { userId: a.userId, assessment: { skillId: assessments.get(a.assessmentId)?.skillId } };
        }
        return a;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        return [...attempts.values()].filter((a) => {
          if (where.userId && a.userId !== where.userId) return false;
          if (where.id?.not && a.id === where.id.not) return false;
          if (where.createdAt?.gte && a.createdAt < where.createdAt.gte) return false;
          if (where.assessment?.skillId && assessments.get(a.assessmentId)?.skillId !== where.assessment.skillId) return false;
          return true;
        });
      }),
    },
    question: {
      findMany: jest.fn(async () => [{ id: 'q-1' }]),
    },
    questionServedAt: {
      createMany: jest.fn(async () => ({})),
    },
    integrityEvent: {
      create: jest.fn(async ({ data }: any) => {
        integrityEvents.push({ attemptId: data.attemptId, type: data.type });
        return { id: nid('evt'), ...data };
      }),
      count: jest.fn(async ({ where }: any) => integrityEvents.filter((e) => e.attemptId === where.attemptId && where.type.in.includes(e.type)).length),
      groupBy: jest.fn(async ({ where }: any) => {
        const relevant = integrityEvents.filter((e) => where.attemptId.in.includes(e.attemptId) && where.type.in.includes(e.type));
        const byAttempt = new Map<string, number>();
        for (const e of relevant) byAttempt.set(e.attemptId, (byAttempt.get(e.attemptId) ?? 0) + 1);
        return [...byAttempt.entries()].map(([attemptId, count]) => ({ attemptId, _count: { _all: count } }));
      }),
    },
    assessmentBlock: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const b of blocks.values()) {
          if (b.userId !== where.userId) continue;
          if (where.liftedAt === null && b.liftedAt !== null) continue;
          if (where.expiresAt?.gt && !(b.expiresAt > where.expiresAt.gt)) continue;
          return b;
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const block: FakeBlock = {
          id: nid('block'),
          liftedAt: null,
          liftedByUserId: null,
          startedAt: new Date(),
          ...data,
        };
        blocks.set(block.id, block);
        return block;
      }),
    },
  };

  return { prisma, assessments, attempts, integrityEvents, blocks, registerAssessment, seedAttempt, seedIntegrityEvents };
}

function makeService(prisma: any) {
  return new AssessmentsService(
    prisma as never,
    { assertLevelAvailable: jest.fn() } as never,
    {} as never,
    {} as never,
    { checkSkillLockEligibility: jest.fn(), checkRetakeEligibility: jest.fn(), refund: jest.fn() } as never,
  );
}

describe('Integrity block — trigger (maybeRaiseIntegrityBlock via addIntegrityEvent)', () => {
  it('blocking-type events below threshold on a single attempt → no block', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1' });
    const service = makeService(db.prisma);

    const attempt = await service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true });
    await service.recordIntegrityEvent('user-1', attempt.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);
    await service.recordIntegrityEvent('user-1', attempt.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);

    expect(db.blocks.size).toBe(0);
  });

  it('non-blocking types (tab blur x20) never raise a block, at any volume', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1' });
    const service = makeService(db.prisma);

    const attempt = await service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true });
    for (let i = 0; i < 20; i++) {
      await service.recordIntegrityEvent('user-1', attempt.id, { type: IntegrityEventType.TAB_BLUR } as any);
    }

    expect(db.blocks.size).toBe(0);
    // Sanity: this did flip FLAGGED (unrelated existing behavior) — proves the
    // test actually exercised addIntegrityEvent's real bookkeeping, not a no-op.
    expect(db.attempts.get(attempt.id)!.integrityStatus).toBe('FLAGGED');
  });

  it('one attempt reaching the blocking threshold alone → no block; a second qualifying attempt for the same skill → block', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1', skillId: 'skill-1' });
    db.registerAssessment({ id: 'a-2', skillId: 'skill-1' });
    const service = makeService(db.prisma);

    const attempt1 = await service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true });
    await service.recordIntegrityEvent('user-1', attempt1.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);
    await service.recordIntegrityEvent('user-1', attempt1.id, { type: IntegrityEventType.COPY_ATTEMPT } as any);
    await service.recordIntegrityEvent('user-1', attempt1.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);
    expect(db.blocks.size).toBe(0); // one failing attempt is not enough

    const attempt2 = await service.startAttempt('user-1', 'a-2', { skipLevelAndRetakeChecks: true });
    await service.recordIntegrityEvent('user-1', attempt2.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);
    await service.recordIntegrityEvent('user-1', attempt2.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);
    await service.recordIntegrityEvent('user-1', attempt2.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);

    expect(db.blocks.size).toBe(1);
    const block = [...db.blocks.values()][0];
    expect(block.userId).toBe('user-1');
    expect(new Set(block.triggerAttemptIds)).toEqual(new Set([attempt1.id, attempt2.id]));
    expect(block.expiresAt.getTime() - block.startedAt.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -2);
  });

  it('a second failing attempt for a DIFFERENT skill does not count — no block', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1', skillId: 'skill-1' });
    db.registerAssessment({ id: 'a-2', skillId: 'skill-2' });
    const service = makeService(db.prisma);

    const attempt1 = await service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true });
    for (let i = 0; i < 3; i++) await service.recordIntegrityEvent('user-1', attempt1.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);

    const attempt2 = await service.startAttempt('user-1', 'a-2', { skipLevelAndRetakeChecks: true });
    for (let i = 0; i < 3; i++) await service.recordIntegrityEvent('user-1', attempt2.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);

    expect(db.blocks.size).toBe(0);
  });

  it('a second failing attempt outside the rolling 7-day window does not count — no block', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1', skillId: 'skill-1' });
    db.registerAssessment({ id: 'a-2', skillId: 'skill-1' });
    const service = makeService(db.prisma);

    // Old, out-of-window failing attempt — seeded directly (8 days ago).
    const oldAttempt = db.seedAttempt({ id: 'old-attempt', userId: 'user-1', assessmentId: 'a-1', createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) });
    db.seedIntegrityEvents(oldAttempt.id, IntegrityEventType.PASTE_ATTEMPT, 3);

    const attempt2 = await service.startAttempt('user-1', 'a-2', { skipLevelAndRetakeChecks: true });
    for (let i = 0; i < 3; i++) await service.recordIntegrityEvent('user-1', attempt2.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);

    expect(db.blocks.size).toBe(0);
  });

  it('does not raise a redundant second block while one is already active for the user', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1', skillId: 'skill-1' });
    db.registerAssessment({ id: 'a-2', skillId: 'skill-1' });
    const service = makeService(db.prisma);

    const attempt1 = await service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true });
    for (let i = 0; i < 3; i++) await service.recordIntegrityEvent('user-1', attempt1.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);
    const attempt2 = await service.startAttempt('user-1', 'a-2', { skipLevelAndRetakeChecks: true });
    for (let i = 0; i < 3; i++) await service.recordIntegrityEvent('user-1', attempt2.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);
    expect(db.blocks.size).toBe(1);

    // Further blocking events on either already-failing attempt, with the block still active, must not raise a second one.
    for (let i = 0; i < 3; i++) await service.recordIntegrityEvent('user-1', attempt1.id, { type: IntegrityEventType.PASTE_ATTEMPT } as any);

    expect(db.blocks.size).toBe(1);
  });
});

describe('Integrity block — enforcement (assertNotBlocked via startAttempt)', () => {
  it('bars starting a new attempt while an active block exists, with a distinct error code and the expiry timestamp', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1' });
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    db.blocks.set('block-1', {
      id: 'block-1',
      userId: 'user-1',
      skillId: 'skill-1',
      startedAt: new Date(),
      expiresAt,
      triggerAttemptIds: [],
      reason: 'test',
      liftedAt: null,
      liftedByUserId: null,
    });
    const service = makeService(db.prisma);

    await expect(service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true })).rejects.toThrow(AssessmentBlockedException);
    try {
      await service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true });
      fail('expected throw');
    } catch (e) {
      const response = (e as AssessmentBlockedException).getResponse() as any;
      expect(response.code).toBe('ASSESSMENT_BLOCKED');
      expect(response.expiresAt).toBe(expiresAt);
    }
  });

  it('an in-progress attempt survives a block raised mid-attempt — resuming it is never blocked', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1' });
    const service = makeService(db.prisma);

    const attempt = await service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true });
    // Raise a block against this same user after the attempt already exists in progress.
    db.blocks.set('block-1', {
      id: 'block-1',
      userId: 'user-1',
      skillId: 'skill-1',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      triggerAttemptIds: [attempt.id],
      reason: 'test',
      liftedAt: null,
      liftedByUserId: null,
    });

    // Resuming (idempotent "active attempt" branch) must succeed despite the active block.
    const resumed = await service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true });
    expect(resumed.id).toBe(attempt.id);
  });

  it('an expired block no longer bars attempts, with no sweep job needed', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1' });
    db.blocks.set('block-1', {
      id: 'block-1',
      userId: 'user-1',
      skillId: 'skill-1',
      startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // expired an hour ago
      triggerAttemptIds: [],
      reason: 'test',
      liftedAt: null,
      liftedByUserId: null,
    });
    const service = makeService(db.prisma);

    await expect(service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true })).resolves.toBeDefined();
  });

  it('a lifted block no longer bars attempts, and the row survives (not deleted)', async () => {
    const db = makeFakeDb();
    db.registerAssessment({ id: 'a-1' });
    db.blocks.set('block-1', {
      id: 'block-1',
      userId: 'user-1',
      skillId: 'skill-1',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      triggerAttemptIds: [],
      reason: 'test',
      liftedAt: new Date(),
      liftedByUserId: 'admin-1',
    });
    const service = makeService(db.prisma);

    await expect(service.startAttempt('user-1', 'a-1', { skipLevelAndRetakeChecks: true })).resolves.toBeDefined();
    expect(db.blocks.has('block-1')).toBe(true);
  });
});
