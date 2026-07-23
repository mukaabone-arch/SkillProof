import { InterviewQuestionCategory, InterviewSessionPhase } from '@prisma/client';

/**
 * The orchestrator's persisted position — stored verbatim as
 * InterviewSession.phaseState. Always represents where the session
 * currently stands, ready to resume from cold (a fresh request handler,
 * a restart) with no other state needed. Mirrors AssessmentSessionsModule's
 * LadderState in spirit: a small, serializable position the *orchestrator*
 * advances deterministically — the LLM is never asked to decide phase
 * transitions, only to phrase language within whatever phase/question the
 * orchestrator has already picked (see this task's own framing: "An
 * open-ended 'you are an interviewer' prompt gives inconsistent coverage
 * and unscoreable sessions — don't do that").
 */
export interface InterviewPhaseState {
  phase: InterviewSessionPhase;
  /** Completed question-and-answer units (base question + at most one
   * follow-up) in the CURRENT phase — checked against
   * targetExchangesFor(phase, state) to decide when to move on. A
   * follow-up does not itself increment this; only finishing a question
   * (with or without a follow-up) does. */
  exchangesInPhase: number;
  /** The 2-3 categories chosen for BEHAVIORAL at session start (excludes
   * MOTIVATION and INDUSTRY_AWARENESS, which have their own dedicated
   * phases) — fixed for the whole session once chosen. */
  behavioralCategories: InterviewQuestionCategory[];
  /** Index into behavioralCategories — which competency BEHAVIORAL is
   * currently on. Only meaningful while phase === 'BEHAVIORAL'. */
  behavioralIndex: number;
  /** InterviewQuestion.id most recently asked — null in OPENING/
   * CANDIDATE_QUESTIONS/CLOSING, which never ask a bank question. */
  currentQuestionId: string | null;
  /** Whether a follow-up has already been asked for currentQuestionId —
   * caps every bank question at exactly one follow-up probe. */
  followUpAsked: boolean;
  /** Every InterviewQuestion.id asked this session, in order — guards
   * against repeats within one session and is exactly what
   * InterviewFeedbackService iterates over at session end. */
  askedQuestionIds: string[];
}

/**
 * Phases in candidate-answer order, CLOSING/SCORING excluded deliberately:
 * CLOSING has no candidate turn to advance on (the coach's closing message
 * itself completes the session — see InterviewSessionsService), and SCORING
 * isn't a conversational phase at all, only the terminal marker reached
 * once CLOSING's message is sent.
 */
const CONVERSATIONAL_PHASE_ORDER: InterviewSessionPhase[] = [
  InterviewSessionPhase.OPENING,
  InterviewSessionPhase.MOTIVATION,
  InterviewSessionPhase.BEHAVIORAL,
  InterviewSessionPhase.INDUSTRY_AWARENESS,
  InterviewSessionPhase.CANDIDATE_QUESTIONS,
];

/**
 * Target completed exchanges for every phase except BEHAVIORAL, whose
 * target is dynamic (behavioralCategories.length — see targetExchangesFor).
 * One question each: OPENING is a single generic icebreaker (never a bank
 * question), MOTIVATION and INDUSTRY_AWARENESS are one bank question each,
 * CANDIDATE_QUESTIONS is the single "anything you'd like to ask me"
 * exchange regardless of what the candidate says.
 */
const FIXED_PHASE_TARGET_EXCHANGES: Partial<Record<InterviewSessionPhase, number>> = {
  [InterviewSessionPhase.OPENING]: 1,
  [InterviewSessionPhase.MOTIVATION]: 1,
  [InterviewSessionPhase.INDUSTRY_AWARENESS]: 1,
  [InterviewSessionPhase.CANDIDATE_QUESTIONS]: 1,
};

export function targetExchangesFor(phase: InterviewSessionPhase, state: InterviewPhaseState): number {
  if (phase === InterviewSessionPhase.BEHAVIORAL) return state.behavioralCategories.length;
  return FIXED_PHASE_TARGET_EXCHANGES[phase] ?? 0;
}

/** 2-3 categories for BEHAVIORAL, drawn from everything except MOTIVATION
 * and INDUSTRY_AWARENESS (dedicated phases) — CULTURE_FIT included here as
 * a behavioral-style competency rather than getting its own phase. `pick`
 * is injectable (defaults to Math.random-backed) purely for deterministic
 * tests; production callers never pass it. */
const BEHAVIORAL_CATEGORY_POOL: InterviewQuestionCategory[] = [
  InterviewQuestionCategory.PROBLEM_SOLVING,
  InterviewQuestionCategory.CONFLICT,
  InterviewQuestionCategory.TEAMWORK,
  InterviewQuestionCategory.INITIATIVE,
  InterviewQuestionCategory.SELF_AWARENESS,
  InterviewQuestionCategory.AMBITION,
  InterviewQuestionCategory.CULTURE_FIT,
  InterviewQuestionCategory.COMMUNICATION,
];

export function pickBehavioralCategories(random: () => number = Math.random): InterviewQuestionCategory[] {
  const count = random() < 0.5 ? 2 : 3;
  const pool = [...BEHAVIORAL_CATEGORY_POOL];
  const picked: InterviewQuestionCategory[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

export function initialPhaseState(behavioralCategories: InterviewQuestionCategory[]): InterviewPhaseState {
  return {
    phase: InterviewSessionPhase.OPENING,
    exchangesInPhase: 0,
    behavioralCategories,
    behavioralIndex: 0,
    currentQuestionId: null,
    followUpAsked: false,
    askedQuestionIds: [],
  };
}

/** True in a phase that asks a bank question and accepts a rule-based/LLM
 * follow-up — OPENING and CANDIDATE_QUESTIONS never do (see
 * FollowUpEligiblePhase's own scoping). */
export function isFollowUpEligiblePhase(phase: InterviewSessionPhase): boolean {
  return (
    phase === InterviewSessionPhase.MOTIVATION ||
    phase === InterviewSessionPhase.BEHAVIORAL ||
    phase === InterviewSessionPhase.INDUSTRY_AWARENESS
  );
}

/**
 * Advances the orchestrator by exactly one completed exchange in the
 * current phase — the orchestrator decides the transition; the LLM has no
 * say in it (see this file's own doc comment). Only ever called once a
 * question is fully resolved (its one allowed follow-up already asked, or
 * skipped because the heuristics found nothing to probe) — never for
 * CLOSING, which InterviewSessionsService transitions out of directly once
 * its message is generated, since there's no candidate answer to advance
 * on. currentQuestionId is deliberately left for the caller to set to the
 * newly-asked question afterward; this function only ever clears it to
 * null on a phase change, since the old question no longer applies.
 */
export function advanceState(state: InterviewPhaseState): InterviewPhaseState {
  if (state.phase === InterviewSessionPhase.CLOSING || state.phase === InterviewSessionPhase.SCORING) {
    throw new Error(`advanceState cannot be called from phase ${state.phase} — there is no candidate exchange to advance on.`);
  }

  const completed = state.exchangesInPhase + 1;
  const target = targetExchangesFor(state.phase, state);
  const cleared = { ...state, followUpAsked: false };

  if (completed < target) {
    // Still within this phase — BEHAVIORAL's next competency.
    return {
      ...cleared,
      exchangesInPhase: completed,
      behavioralIndex: state.phase === InterviewSessionPhase.BEHAVIORAL ? state.behavioralIndex + 1 : state.behavioralIndex,
      currentQuestionId: null,
    };
  }

  const currentIdx = CONVERSATIONAL_PHASE_ORDER.indexOf(state.phase);
  const nextPhase = CONVERSATIONAL_PHASE_ORDER[currentIdx + 1] ?? InterviewSessionPhase.CLOSING;
  return {
    ...cleared,
    phase: nextPhase,
    exchangesInPhase: 0,
    behavioralIndex: nextPhase === InterviewSessionPhase.BEHAVIORAL ? 0 : state.behavioralIndex,
    currentQuestionId: null,
  };
}

/**
 * Per-session hard caps, checked independently of the idle-timeout
 * (InterviewSession.expiresAt, enforced the same "lazy check on every
 * touching endpoint" way AssessmentSessionsService does) — this bounds
 * total cost/length even for a candidate who never goes idle. Env-
 * overridable, same convention as the assessment module's own caps.
 */
export const MAX_SESSION_TURNS = Number(process.env.INTERVIEW_SESSION_MAX_TURNS) || 40;
export const MAX_SESSION_DURATION_MINUTES = Number(process.env.INTERVIEW_SESSION_MAX_DURATION_MINUTES) || 30;

/**
 * True once either cap is hit and the session isn't already winding down —
 * the caller should skip straight to CLOSING instead of continuing the
 * phase machine. Pure so it's directly testable; the caller supplies
 * turnCount/elapsedMs rather than this reaching into Date.now()/the DB
 * itself.
 */
export function capExceeded(state: InterviewPhaseState, turnCount: number, elapsedMs: number): boolean {
  if (state.phase === InterviewSessionPhase.CLOSING || state.phase === InterviewSessionPhase.SCORING) return false;
  return turnCount >= MAX_SESSION_TURNS || elapsedMs >= MAX_SESSION_DURATION_MINUTES * 60_000;
}

/** Candidate-facing progress — a coarse phase + count, never the raw
 * phaseState (see InterviewSessionsService.toPublicSession). Mirrors
 * AssessmentSessionsService.computeProgress's "just a count" shape. */
export function computeProgress(state: InterviewPhaseState): { phase: InterviewSessionPhase; current: number; total: number } {
  const total = targetExchangesFor(state.phase, state) || 1;
  return { phase: state.phase, current: Math.min(state.exchangesInPhase + 1, total), total };
}
