import { InterviewQuestionCategory, InterviewSessionPhase } from '@prisma/client';
import {
  advanceState,
  capExceeded,
  computeProgress,
  initialPhaseState,
  InterviewPhaseState,
  isFollowUpEligiblePhase,
  MAX_SESSION_DURATION_MINUTES,
  MAX_SESSION_TURNS,
  pickBehavioralCategories,
  targetExchangesFor,
} from './interview-orchestrator';

const TWO_CATEGORIES = [InterviewQuestionCategory.CONFLICT, InterviewQuestionCategory.TEAMWORK];
const THREE_CATEGORIES = [
  InterviewQuestionCategory.CONFLICT,
  InterviewQuestionCategory.TEAMWORK,
  InterviewQuestionCategory.INITIATIVE,
];

describe('initialPhaseState', () => {
  it('starts at OPENING with zero progress', () => {
    const state = initialPhaseState(TWO_CATEGORIES);
    expect(state.phase).toBe(InterviewSessionPhase.OPENING);
    expect(state.exchangesInPhase).toBe(0);
    expect(state.behavioralIndex).toBe(0);
    expect(state.currentQuestionId).toBeNull();
    expect(state.followUpAsked).toBe(false);
    expect(state.askedQuestionIds).toEqual([]);
  });
});

describe('advanceState — full walk through every phase', () => {
  it('OPENING -> MOTIVATION -> BEHAVIORAL (2 categories) -> INDUSTRY_AWARENESS -> CANDIDATE_QUESTIONS -> CLOSING', () => {
    let state = initialPhaseState(TWO_CATEGORIES);

    state = advanceState(state); // OPENING's single exchange done
    expect(state.phase).toBe(InterviewSessionPhase.MOTIVATION);
    expect(state.exchangesInPhase).toBe(0);

    state = advanceState(state); // MOTIVATION's single question done
    expect(state.phase).toBe(InterviewSessionPhase.BEHAVIORAL);
    expect(state.exchangesInPhase).toBe(0);
    expect(state.behavioralIndex).toBe(0);

    state = advanceState(state); // first of 2 BEHAVIORAL competencies done
    expect(state.phase).toBe(InterviewSessionPhase.BEHAVIORAL); // still in BEHAVIORAL
    expect(state.exchangesInPhase).toBe(1);
    expect(state.behavioralIndex).toBe(1);

    state = advanceState(state); // second (last) of 2 BEHAVIORAL competencies done
    expect(state.phase).toBe(InterviewSessionPhase.INDUSTRY_AWARENESS);
    expect(state.exchangesInPhase).toBe(0);

    state = advanceState(state); // INDUSTRY_AWARENESS's single question done
    expect(state.phase).toBe(InterviewSessionPhase.CANDIDATE_QUESTIONS);

    state = advanceState(state); // CANDIDATE_QUESTIONS' single exchange done
    expect(state.phase).toBe(InterviewSessionPhase.CLOSING);
  });

  it('BEHAVIORAL with 3 categories walks through all three before advancing', () => {
    let state: InterviewPhaseState = { ...initialPhaseState(THREE_CATEGORIES), phase: InterviewSessionPhase.BEHAVIORAL };

    state = advanceState(state);
    expect(state.phase).toBe(InterviewSessionPhase.BEHAVIORAL);
    expect(state.behavioralIndex).toBe(1);

    state = advanceState(state);
    expect(state.phase).toBe(InterviewSessionPhase.BEHAVIORAL);
    expect(state.behavioralIndex).toBe(2);

    state = advanceState(state);
    expect(state.phase).toBe(InterviewSessionPhase.INDUSTRY_AWARENESS);
  });

  it('clears followUpAsked and currentQuestionId on every advance', () => {
    const state = {
      ...initialPhaseState(TWO_CATEGORIES),
      phase: InterviewSessionPhase.MOTIVATION,
      followUpAsked: true,
      currentQuestionId: 'q-1',
    };
    const next = advanceState(state);
    expect(next.followUpAsked).toBe(false);
    expect(next.currentQuestionId).toBeNull();
  });

  it('throws if called from CLOSING or SCORING — there is no candidate exchange to advance on', () => {
    const closing = { ...initialPhaseState(TWO_CATEGORIES), phase: InterviewSessionPhase.CLOSING };
    const scoring = { ...initialPhaseState(TWO_CATEGORIES), phase: InterviewSessionPhase.SCORING };
    expect(() => advanceState(closing)).toThrow();
    expect(() => advanceState(scoring)).toThrow();
  });
});

describe('targetExchangesFor', () => {
  it('is 1 for every fixed phase', () => {
    const state = initialPhaseState(TWO_CATEGORIES);
    expect(targetExchangesFor(InterviewSessionPhase.OPENING, state)).toBe(1);
    expect(targetExchangesFor(InterviewSessionPhase.MOTIVATION, state)).toBe(1);
    expect(targetExchangesFor(InterviewSessionPhase.INDUSTRY_AWARENESS, state)).toBe(1);
    expect(targetExchangesFor(InterviewSessionPhase.CANDIDATE_QUESTIONS, state)).toBe(1);
  });

  it('BEHAVIORAL is dynamic — driven by behavioralCategories.length', () => {
    expect(targetExchangesFor(InterviewSessionPhase.BEHAVIORAL, initialPhaseState(TWO_CATEGORIES))).toBe(2);
    expect(targetExchangesFor(InterviewSessionPhase.BEHAVIORAL, initialPhaseState(THREE_CATEGORIES))).toBe(3);
  });
});

describe('pickBehavioralCategories', () => {
  it('picks 2 distinct categories when random() < 0.5', () => {
    const seq = [0.1, 0.2, 0.3];
    let i = 0;
    const categories = pickBehavioralCategories(() => seq[i++]);
    expect(categories).toHaveLength(2);
    expect(new Set(categories).size).toBe(2);
  });

  it('picks 3 distinct categories when random() >= 0.5', () => {
    const seq = [0.6, 0.1, 0.2, 0.3];
    let i = 0;
    const categories = pickBehavioralCategories(() => seq[i++]);
    expect(categories).toHaveLength(3);
    expect(new Set(categories).size).toBe(3);
  });

  it('never includes MOTIVATION or INDUSTRY_AWARENESS — those have dedicated phases', () => {
    const categories = pickBehavioralCategories(() => 0.6);
    expect(categories).not.toContain(InterviewQuestionCategory.MOTIVATION);
    expect(categories).not.toContain(InterviewQuestionCategory.INDUSTRY_AWARENESS);
  });
});

describe('isFollowUpEligiblePhase', () => {
  it('true for MOTIVATION, BEHAVIORAL, INDUSTRY_AWARENESS', () => {
    expect(isFollowUpEligiblePhase(InterviewSessionPhase.MOTIVATION)).toBe(true);
    expect(isFollowUpEligiblePhase(InterviewSessionPhase.BEHAVIORAL)).toBe(true);
    expect(isFollowUpEligiblePhase(InterviewSessionPhase.INDUSTRY_AWARENESS)).toBe(true);
  });

  it('false for OPENING, CANDIDATE_QUESTIONS, CLOSING, SCORING — no bank question to probe deeper on', () => {
    expect(isFollowUpEligiblePhase(InterviewSessionPhase.OPENING)).toBe(false);
    expect(isFollowUpEligiblePhase(InterviewSessionPhase.CANDIDATE_QUESTIONS)).toBe(false);
    expect(isFollowUpEligiblePhase(InterviewSessionPhase.CLOSING)).toBe(false);
    expect(isFollowUpEligiblePhase(InterviewSessionPhase.SCORING)).toBe(false);
  });
});

describe('capExceeded', () => {
  const state = { ...initialPhaseState(TWO_CATEGORIES), phase: InterviewSessionPhase.BEHAVIORAL };

  it('false well under both caps', () => {
    expect(capExceeded(state, 5, 60_000)).toBe(false);
  });

  it('true once the turn cap is reached', () => {
    expect(capExceeded(state, MAX_SESSION_TURNS, 60_000)).toBe(true);
  });

  it('true once the duration cap is reached', () => {
    expect(capExceeded(state, 5, MAX_SESSION_DURATION_MINUTES * 60_000)).toBe(true);
  });

  it('never true once already in CLOSING or SCORING — nothing left to cut short', () => {
    const closing = { ...state, phase: InterviewSessionPhase.CLOSING };
    const scoring = { ...state, phase: InterviewSessionPhase.SCORING };
    expect(capExceeded(closing, MAX_SESSION_TURNS + 10, MAX_SESSION_DURATION_MINUTES * 60_000 + 10)).toBe(false);
    expect(capExceeded(scoring, MAX_SESSION_TURNS + 10, MAX_SESSION_DURATION_MINUTES * 60_000 + 10)).toBe(false);
  });
});

describe('computeProgress', () => {
  it('reports 1-indexed current against the phase target', () => {
    const state = { ...initialPhaseState(THREE_CATEGORIES), phase: InterviewSessionPhase.BEHAVIORAL, exchangesInPhase: 1 };
    expect(computeProgress(state)).toEqual({ phase: InterviewSessionPhase.BEHAVIORAL, current: 2, total: 3 });
  });

  it('never exceeds total even if exchangesInPhase is at the boundary', () => {
    const state = { ...initialPhaseState(TWO_CATEGORIES), phase: InterviewSessionPhase.MOTIVATION, exchangesInPhase: 0 };
    expect(computeProgress(state)).toEqual({ phase: InterviewSessionPhase.MOTIVATION, current: 1, total: 1 });
  });
});
