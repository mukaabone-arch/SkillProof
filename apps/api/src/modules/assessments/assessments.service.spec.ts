import { ForbiddenException } from '@nestjs/common';
import { AssessmentsService } from './assessments.service';

/**
 * Focused on getResult's topicBreakdown — the aggregation itself
 * (buildTopicBreakdown) and the leak boundary around it (only
 * { topic, correct, asked } counts ever leave the server, even though
 * Question.correct's whole JSON blob — answer, sourceId, explanation — is
 * necessarily read into memory to get at `topic`). Everything else getResult
 * returns is exercised implicitly since these tests go through the real
 * method, not a hand-picked subset.
 */
type AttemptAnswerRow = { isCorrect: boolean | null; question: { correct: unknown } };

function fakePrisma(overrides: {
  attempt: { userId: string; badge?: unknown; assessment: { title: string; passThreshold: number; skill: { name: string } } };
  attemptAnswers: AttemptAnswerRow[];
}) {
  return {
    attempt: {
      // Called twice by getResult — once via getOwnedAttempt (ownership
      // check, `include: { assessment: true }`), once for the full record
      // (`include: { badge, assessment: { skill } }`). Same fake row covers
      // both regardless of which include was requested.
      findUnique: jest.fn(async () => ({
        id: 'attempt-1',
        status: 'GRADED',
        scorePercent: 80,
        passed: true,
        userId: overrides.attempt.userId,
        badge: overrides.attempt.badge ?? null,
        assessment: overrides.attempt.assessment,
      })),
    },
    attemptAnswer: {
      findMany: jest.fn(async () => overrides.attemptAnswers),
    },
  };
}

function makeService(overrides: Parameters<typeof fakePrisma>[0]) {
  const prisma = fakePrisma(overrides);
  const service = new AssessmentsService(
    prisma as never,
    {} as never, // BadgeResolverService — unused by getResult
    {} as never, // AssessmentSessionsService — unused by getResult
    {} as never, // CandidateJobsService — unused by getResult
    {} as never, // EntitlementsService — unused by getResult
  );
  return { service, prisma };
}

const baseAssessment = { title: 'RAG Systems L1', passThreshold: 70, skill: { name: 'RAG Systems' } };

function answer(topic: string | null, isCorrect: boolean | null): AttemptAnswerRow {
  return {
    isCorrect,
    // The full shape every real question's `correct` JSON carries — proves
    // the aggregation reads ONLY topic even though answer/explanation/
    // sourceId are right there in the same object it has in memory.
    question: { correct: { answer: 0, sourceId: `src-${Math.random()}`, explanation: 'Because X, not Y.', topic } },
  };
}

describe('AssessmentsService.getResult — topicBreakdown', () => {
  it('groups answers by topic into { topic, correct, asked } counts', async () => {
    const { service } = makeService({
      attempt: { userId: 'user-1', assessment: baseAssessment },
      attemptAnswers: [
        answer('Chunking', true),
        answer('Chunking', false),
        answer('Chunking', true),
        answer('Reranking', true),
        answer('Reranking', true),
      ],
    });

    const result = await service.getResult('user-1', 'attempt-1');

    expect(result.topicBreakdown.excludedCount).toBe(0);
    const byTopic = Object.fromEntries(result.topicBreakdown.topics.map((t) => [t.topic, t]));
    expect(byTopic.Chunking).toEqual({ topic: 'Chunking', correct: 2, asked: 3 });
    expect(byTopic.Reranking).toEqual({ topic: 'Reranking', correct: 2, asked: 2 });
  });

  it('excludes null-topic questions rather than bucketing them under "Other", and reports how many were excluded', async () => {
    const { service } = makeService({
      attempt: { userId: 'user-1', assessment: baseAssessment },
      attemptAnswers: [answer('Chunking', true), answer(null, true), answer(null, false)],
    });

    const result = await service.getResult('user-1', 'attempt-1');

    expect(result.topicBreakdown.topics).toEqual([{ topic: 'Chunking', correct: 1, asked: 1 }]);
    expect(result.topicBreakdown.excludedCount).toBe(2);
  });

  it('a wrong answer counts toward asked but not correct', async () => {
    const { service } = makeService({
      attempt: { userId: 'user-1', assessment: baseAssessment },
      attemptAnswers: [answer('Evaluation', false)],
    });

    const result = await service.getResult('user-1', 'attempt-1');

    expect(result.topicBreakdown.topics).toEqual([{ topic: 'Evaluation', correct: 0, asked: 1 }]);
  });

  it('an attempt with no answers returns an empty breakdown, not an error', async () => {
    const { service } = makeService({
      attempt: { userId: 'user-1', assessment: baseAssessment },
      attemptAnswers: [],
    });

    const result = await service.getResult('user-1', 'attempt-1');

    expect(result.topicBreakdown).toEqual({ topics: [], excludedCount: 0 });
  });

  it('never leaks question-level detail — no questionId, answer, explanation, or sourceId anywhere in the response', async () => {
    const { service } = makeService({
      attempt: { userId: 'user-1', assessment: baseAssessment },
      attemptAnswers: [answer('Chunking', true), answer('Chunking', false)],
    });

    const result = await service.getResult('user-1', 'attempt-1');
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('explanation');
    expect(serialized).not.toContain('sourceId');
    expect(serialized).not.toContain('questionId');
    // The only "answer"-shaped thing allowed through is scorePercent/passed
    // — the raw per-question `answer` index (0 in every fixture row above)
    // must never surface as a bare, unlabeled value tied to a topic.
    expect(result.topicBreakdown.topics.every((t) => Object.keys(t).sort().join(',') === 'asked,correct,topic')).toBe(
      true,
    );
  });

  it('still enforces IDOR protection — a caller who does not own the attempt is forbidden, topicBreakdown or not', async () => {
    const { service } = makeService({
      attempt: { userId: 'someone-else', assessment: baseAssessment },
      attemptAnswers: [answer('Chunking', true)],
    });

    await expect(service.getResult('user-1', 'attempt-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
