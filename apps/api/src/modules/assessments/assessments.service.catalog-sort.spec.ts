import { AttemptStatus, SkillLevel, SubscriptionTier } from '@prisma/client';
import { AssessmentsService } from './assessments.service';

/**
 * Focused on getCatalog's personalised ordering (sortByRecentActivity) —
 * buildSkillBuckets itself (the skill/level/badge grid) is exercised only
 * as far as it takes to produce a realistic two-or-three-skill catalog;
 * the actual assertions are all about final array order.
 */
interface FakeAssessmentRow {
  id: string;
  skillId: string;
  skillName: string;
  domainName: string;
  targetLevel: SkillLevel;
  durationMins: number;
  title: string;
}

function fakePrisma(overrides: {
  assessments: FakeAssessmentRow[];
  gradedAttempts?: { assessmentId: string; createdAt: Date }[];
}) {
  return {
    assessment: {
      findMany: jest.fn(async () =>
        overrides.assessments.map((a) => ({
          id: a.id,
          skillId: a.skillId,
          targetLevel: a.targetLevel,
          durationMins: a.durationMins,
          title: a.title,
          skill: { name: a.skillName, description: null, domain: { name: a.domainName } },
        })),
      ),
    },
    // No discussion skill in any of these fixtures — AssessmentSessionsService
    // is never called as a result (buildSkillBuckets short-circuits on this
    // being null), so it's never faked below either.
    skill: { findFirst: jest.fn(async () => null) },
    attempt: {
      findMany: jest.fn(async ({ where }: { where: { status: AttemptStatus } }) => {
        if (where.status !== AttemptStatus.GRADED) return [];
        return overrides.gradedAttempts ?? [];
      }),
    },
    assessmentSession: { findFirst: jest.fn(async () => null) },
  };
}

function noBadges() {
  return { resolveLevelMap: jest.fn(async () => ({})), resolveLevelMapWithExpired: jest.fn(async () => ({})) };
}

function fakeEntitlements(overrides: {
  tier?: SubscriptionTier;
  singleSkillRestriction?: boolean;
  freeSkillLockSkillId?: string;
}) {
  return {
    getEntitlements: jest.fn(async () => ({
      tier: overrides.tier ?? SubscriptionTier.PREMIUM,
      limits: { singleSkillRestriction: overrides.singleSkillRestriction ?? false },
      freeSkillLock: overrides.freeSkillLockSkillId
        ? { skillId: overrides.freeSkillLockSkillId, skillName: 'Locked Skill' }
        : null,
    })),
  };
}

function makeService(prismaOverrides: Parameters<typeof fakePrisma>[0], entitlementsOverrides: Parameters<typeof fakeEntitlements>[0] = {}) {
  const prisma = fakePrisma(prismaOverrides);
  const service = new AssessmentsService(
    prisma as never,
    noBadges() as never,
    {} as never, // AssessmentSessionsService — unused (no discussion skill in these fixtures)
    {} as never, // CandidateJobsService — unused by getCatalog
    fakeEntitlements(entitlementsOverrides) as never,
  );
  return { service, prisma };
}

function assessment(skillId: string, skillName: string, overrides: Partial<FakeAssessmentRow> = {}): FakeAssessmentRow {
  return {
    id: `${skillId}-l1`,
    skillId,
    skillName,
    domainName: 'AI Engineering',
    targetLevel: SkillLevel.L1,
    durationMins: 30,
    title: skillName,
    ...overrides,
  };
}

describe('AssessmentsService.getCatalog — recent-activity ordering', () => {
  it('with no attempts at all, preserves buildSkillBuckets\' original order', async () => {
    const { service } = makeService({
      assessments: [assessment('skill-a', 'Prompt Engineering'), assessment('skill-b', 'RAG Systems')],
    });

    const result = await service.getCatalog('user-1');

    expect(result.map((s) => s.skillId)).toEqual(['skill-a', 'skill-b']);
  });

  it('a skill with a more recent GRADED attempt sorts before one with an older GRADED attempt', async () => {
    const { service } = makeService({
      assessments: [assessment('skill-a', 'Prompt Engineering'), assessment('skill-b', 'RAG Systems')],
      gradedAttempts: [
        { assessmentId: 'skill-a-l1', createdAt: new Date('2026-01-01') },
        { assessmentId: 'skill-b-l1', createdAt: new Date('2026-06-01') },
      ],
    });

    const result = await service.getCatalog('user-1');

    expect(result.map((s) => s.skillId)).toEqual(['skill-b', 'skill-a']);
  });

  it('attempted skills sort before never-attempted skills, which keep their own relative order', async () => {
    const { service } = makeService({
      assessments: [
        assessment('skill-a', 'Prompt Engineering'),
        assessment('skill-b', 'RAG Systems'),
        assessment('skill-c', 'Model Deployment'),
      ],
      gradedAttempts: [{ assessmentId: 'skill-c-l1', createdAt: new Date('2026-01-01') }],
    });

    const result = await service.getCatalog('user-1');

    expect(result.map((s) => s.skillId)).toEqual(['skill-c', 'skill-a', 'skill-b']);
  });

  it('only ever queries GRADED attempts — matches checkRetakeEligibility\'s own definition of a real prior attempt, so an abandoned CREATED/IN_PROGRESS/SUBMITTED/GRADING row can never count', async () => {
    const { service, prisma } = makeService({
      assessments: [assessment('skill-a', 'Prompt Engineering'), assessment('skill-b', 'RAG Systems')],
      gradedAttempts: [{ assessmentId: 'skill-a-l1', createdAt: new Date('2026-01-01') }],
    });

    await service.getCatalog('user-1');

    expect(prisma.attempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: AttemptStatus.GRADED }) }),
    );
  });

  it('a FREE candidate\'s locked skill pins first even with no graded attempt at all, ahead of a skill with real recent activity', async () => {
    const { service } = makeService(
      {
        assessments: [assessment('skill-a', 'Prompt Engineering'), assessment('skill-b', 'RAG Systems')],
        gradedAttempts: [{ assessmentId: 'skill-a-l1', createdAt: new Date('2026-06-01') }],
      },
      { tier: SubscriptionTier.FREE, singleSkillRestriction: true, freeSkillLockSkillId: 'skill-b' },
    );

    const result = await service.getCatalog('user-1');

    expect(result.map((s) => s.skillId)).toEqual(['skill-b', 'skill-a']);
  });

  it('the free-skill lock pin has no effect for a PREMIUM candidate — pure recency applies', async () => {
    const { service } = makeService(
      {
        assessments: [assessment('skill-a', 'Prompt Engineering'), assessment('skill-b', 'RAG Systems')],
        gradedAttempts: [{ assessmentId: 'skill-a-l1', createdAt: new Date('2026-06-01') }],
      },
      { tier: SubscriptionTier.PREMIUM, singleSkillRestriction: false },
    );

    const result = await service.getCatalog('user-1');

    expect(result.map((s) => s.skillId)).toEqual(['skill-a', 'skill-b']);
  });
});
