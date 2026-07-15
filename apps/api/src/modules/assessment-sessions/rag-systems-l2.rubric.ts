import { RagL2Claim } from '@prisma/client';

/**
 * The scenario handed to the candidate verbatim at session start, and
 * returned as-is on AssessmentSession.pinnedBrief. Kept as a constant
 * (never LLM-authored) so the client can rely on its exact wording.
 */
export const SCENARIO_BRIEF =
  'Design a retrieval layer for 40M support tickets. Sub-second p95, and the corpus changes hourly.';

/**
 * Exact wording of the two reflection-stage questions (spec-mandated,
 * never LLM-authored — these are appended verbatim, not paraphrased).
 */
export const REFLECTION_QUESTIONS = [
  'What would you improve about your design if you had another week?',
  "What assumptions did you make that you'd want to check?",
] as const;

/**
 * Ladder order — the sequence AssessorService walks claims in. This list,
 * not the enum declaration order, is what drives progression.
 */
export const CLAIM_ORDER: RagL2Claim[] = [
  RagL2Claim.CHUNKING,
  RagL2Claim.DIAGNOSIS,
  RagL2Claim.RERANKING,
  RagL2Claim.CORPUS_CHANGE,
  RagL2Claim.EVALUATION,
  RagL2Claim.COST,
];

/**
 * Per-claim probe content. These are instructions *to the model* (internal
 * context, never shown to the candidate) describing what ground each rung
 * should cover for this claim — not verbatim questions. The assessor
 * phrases the actual message itself, conversationally, each turn.
 */
export interface ClaimProbeHints {
  /** Short internal label — used only in logs/prompts, never surfaced. */
  label: string;
  /** What the OPENING probe for this claim should get the candidate reasoning about. */
  opening: string;
  /** What the FOLLOWUP nudge should point the candidate toward, if their opening answer was thin. */
  followup: string;
  /** The requirement change to introduce, in the interviewer's own voice, once this claim's opening/followup has landed. */
  constraint: string;
  /**
   * Literal, ready-to-send sentences — used only as a deterministic safety
   * net when the model's draft trips the leak guard twice (see
   * AssessorService.generateGuardedMessage). Never sent as the model's
   * primary output; these exist so a guardrail failure still delivers a
   * correct, on-topic turn instead of a generic non-answer.
   */
  fallback: { opening: string; followup: string; constraint: string };
}

export const CLAIM_HINTS: Record<RagL2Claim, ClaimProbeHints> = {
  CHUNKING: {
    label: 'chunking strategy',
    opening:
      "Ask how they'd chunk the 40M support tickets for retrieval — get them reasoning about ticket structure and length variance, not just a generic 'use fixed-size chunks' answer.",
    followup:
      'Nudge them toward tickets that are far longer or shorter than average — e.g. long email-thread tickets with quoted history — and ask what happens to those under their chunking approach.',
    constraint:
      'Tell them, in your own words: tickets often include long email threads with quoted history, and some are 50x the length of a typical ticket. Ask whether their chunking strategy still holds up.',
    fallback: {
      opening: 'How would you go about chunking the 40 million support tickets for retrieval?',
      followup:
        'What about tickets that are much longer than average — say, ones with a long back-and-forth email thread attached?',
      constraint:
        "Actually, one thing I should mention — tickets often include long email threads with quoted history, and some run 50 times longer than a typical ticket. Does your chunking approach still hold up?",
    },
  },
  DIAGNOSIS: {
    label: 'diagnosing retrieval quality issues',
    opening:
      "Ask how they'd diagnose the problem if users start complaining that the assistant surfaces irrelevant tickets.",
    followup:
      "Nudge them to be concrete about where they'd look first — embeddings, chunking, the reranker, or something else — rather than a vague 'I'd investigate'.",
    constraint:
      'Tell them, in your own words: the diagnosis points to embedding drift, because ticket vocabulary shifts every quarter as new products launch. Ask how that changes their approach.',
    fallback: {
      opening:
        "Say users start complaining that the assistant is surfacing irrelevant tickets. How would you go about diagnosing what's wrong?",
      followup: "Where would you actually look first — the embeddings, the chunking, the reranker, something else?",
      constraint:
        'Suppose the diagnosis points to embedding drift, since the ticket vocabulary shifts every quarter as new products launch. How does that change your approach?',
    },
  },
  RERANKING: {
    label: 'reranking and relevance under the latency budget',
    opening:
      "Ask how they'd decide, among retrieved candidates, what's actually relevant enough to show — and what role reranking plays in that.",
    followup:
      'Nudge them to connect this back to the sub-second p95 latency requirement — does their approach still fit the time budget?',
    constraint:
      "Tell them, in your own words: end-to-end p95 latency needs to stay under 500ms, and reranking alone is currently eating 300ms of that. Ask what they'd do.",
    fallback: {
      opening:
        "Once you've retrieved a set of candidates, how do you decide what's actually relevant enough to show the agent?",
      followup: 'Given the sub-second p95 latency target, does that change what you can afford to do here?',
      constraint:
        'Here\'s a wrinkle — end-to-end p95 latency needs to stay under 500 milliseconds, and reranking alone is currently eating 300 of those. What would you do?',
    },
  },
  CORPUS_CHANGE: {
    label: 'handling the hourly-changing corpus',
    opening: "Ask how their design handles the fact that the corpus changes hourly.",
    followup:
      "Nudge them to be specific about the mechanics — is it just appending new documents, or does something structural need to happen, like re-indexing or versioning?",
    constraint:
      'Tell them, in your own words, something like: "Actually, one thing I should mention — the corpus doubles in size hourly, not just changes." Ask whether that breaks anything they\'ve proposed.',
    fallback: {
      opening: 'The corpus changes hourly. How does your design handle that?',
      followup:
        'What specifically has to happen when new tickets come in — is it just appending, or does something more structural need to happen?',
      constraint:
        'Actually, one thing I should mention — the corpus doubles in size hourly, not just changes. Does that break anything you\'ve proposed?',
    },
  },
  EVALUATION: {
    label: 'evaluating retrieval quality before shipping',
    opening: "Ask how they'd know whether this retrieval system is actually working well before shipping it.",
    followup: 'Nudge them on where ground-truth relevance labels would even come from at this scale.',
    constraint:
      "Tell them, in your own words: there's no labeled relevance data available at all right now. Ask how they'd evaluate the system without it.",
    fallback: {
      opening: "Before shipping this, how would you know whether the retrieval system is actually working well?",
      followup: 'Where would ground-truth relevance labels even come from at this scale?',
      constraint:
        "Suppose there's no labeled relevance data available at all right now. How would you evaluate the system without it?",
    },
  },
  COST: {
    label: 'cost tradeoffs at scale',
    opening: 'Ask what the cost tradeoffs look like in their design at 40M tickets.',
    followup:
      "Nudge them to identify what's actually driving the cost the most — storage, embedding compute, reranking compute, or something else.",
    constraint:
      "Tell them, in your own words: the team has a hard budget cap that's roughly a third of what their current design implies. Ask what they'd cut or change.",
    fallback: {
      opening: 'At 40 million tickets, what do the cost tradeoffs look like in your design?',
      followup:
        "What's actually driving the cost the most here — storage, embedding compute, reranking compute, something else?",
      constraint:
        "Say the team hands you a hard budget cap that's roughly a third of what your current design implies. What would you cut or change?",
    },
  },
};

export const GENERIC_FALLBACKS = {
  transitionPrefix: "Good, that's helpful. ",
  reflectionTransition: "Thanks — that's given me a solid picture of your design thinking.",
  close:
    "That's everything I wanted to cover today — thank you for walking through your thinking with me. This conversation will be reviewed by a person on our team, and you'll hear back within about a day.",
  resumePrefix: 'Sorry about that, small pause on my end — picking back up. ',
} as const;
