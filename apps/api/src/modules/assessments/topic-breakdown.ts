export interface TopicStat {
  topic: string;
  correct: number;
  asked: number;
}

export interface TopicBreakdown {
  topics: TopicStat[];
  excludedCount: number;
}

/** The minimal shape buildTopicBreakdown needs from an AttemptAnswer row — matches `select: { isCorrect: true, question: { select: { correct: true } } }`. */
export interface TopicBreakdownAnswerRow {
  isCorrect: boolean | null;
  question: { correct: unknown };
}

/**
 * Reduces an attempt's answers into { topic, correct, asked } counts — the
 * only thing this is ever allowed to return. `question.correct` (the query
 * this expects its input from — see AssessmentsService.getResult and
 * AssessmentsService.getScoreAndTopicBreakdown) carries the whole grading
 * payload — `answer`, `sourceId`, `explanation`, `topic` — because
 * Postgres/Prisma can't project a single key out of a JSON column; the
 * server necessarily reads the whole blob into memory. The leak boundary is
 * what leaves this function, not what it reads: only `topic` is ever
 * touched, and the return value is a plain aggregate with no questionId, no
 * `answer`, no `explanation`, nothing a candidate — or an employer who paid
 * for the assessment — could use to reconstruct which question was asked or
 * what the right answer was. Both callers share this exact function rather
 * than each reimplementing the aggregation, specifically so this boundary is
 * enforced in one place: if this ever needs more per-topic detail, add it as
 * another *count* here, not as anything that echoes a single question back
 * in either caller.
 *
 * Null-topic questions (25 of 1,125 today) are excluded rather than bucketed
 * under an "Other" topic — that bucket wouldn't be actionable study
 * guidance, just noise. excludedCount lets the caller say so honestly
 * ("performance by topic", not "every question") instead of silently
 * under-counting.
 */
export function buildTopicBreakdown(answers: TopicBreakdownAnswerRow[]): TopicBreakdown {
  const byTopic = new Map<string, { correct: number; asked: number }>();
  let excludedCount = 0;
  for (const a of answers) {
    const topic = (a.question.correct as { topic?: string | null } | null)?.topic;
    if (!topic) {
      excludedCount += 1;
      continue;
    }
    const bucket = byTopic.get(topic) ?? { correct: 0, asked: 0 };
    bucket.asked += 1;
    if (a.isCorrect) bucket.correct += 1;
    byTopic.set(topic, bucket);
  }
  return {
    topics: Array.from(byTopic.entries()).map(([topic, counts]) => ({ topic, ...counts })),
    excludedCount,
  };
}
