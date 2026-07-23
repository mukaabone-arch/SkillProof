/**
 * Every fixed, non-LLM string the coach ever sends. Deliberately templated
 * rather than model-generated, in deliberate contrast to
 * AssessmentSessionsModule's AssessorService (which calls the model for
 * nearly every turn to sound naturally conversational): this feature's own
 * framing is "minimize inference cost" and "Questions come from the
 * database, not the model," so the connective tissue between bank
 * questions — welcomes, transitions, the close — is zero-cost, hand-written
 * copy instead. The one and only place a model runs *during* a live session
 * is the rare LLM_CHOICE follow-up fallback (see follow-up-heuristics.ts);
 * the bigger, batched feedback pass happens once, after the session ends
 * (see InterviewFeedbackService).
 *
 * Every list has 2 variants purely so a candidate doing a second practice
 * session doesn't see identical connective phrasing every time (the actual
 * *questions* varying is InterviewQuestionSelector's job, driven by the
 * question bank's own size — see that file).
 */

export const OPENING_MESSAGE =
  "Hi! I'm going to be your practice interviewer today — think of this as a low-stakes rehearsal, not a real " +
  "evaluation. We'll go through a few behavioral questions, similar to what you'd get in a real interview, and " +
  "I'll give you detailed feedback at the end rather than interrupting as we go — that's closer to how a real " +
  "interview feels, and it means you can just focus on answering. Should take about 15-20 minutes.\n\n" +
  "Let's start simple: tell me a bit about yourself and what kind of role you're looking for next.";

const MOTIVATION_TRANSITIONS = [
  "Thanks for that — let's get into a few specific questions.",
  "Good, that helps me get a sense of where you're coming from. Let's dig into some specifics.",
];

const BEHAVIORAL_TRANSITIONS = [
  "Got it — let's shift into a few questions about how you've actually handled things day to day.",
  "That's helpful context. Now let's talk through some specific situations you've been in.",
];

const INDUSTRY_TRANSITIONS = [
  "Let's zoom out for a moment.",
  "One more before we wrap up the specific-situation questions.",
];

const CANDIDATE_QUESTIONS_INVITES = [
  'Before we close out, is there anything you\'d like to ask me{{roleContext}}?',
  'Last thing — anything you want to ask me{{roleContext}}, or about interviewing in general?',
];

/** Substitutes the {{roleContext}} placeholder with a real job/employer
 * reference when the session is grounded in an application, or removes it
 * cleanly when there's none — see InterviewSessionsService's grounding
 * lookup. This is the one place company-grounding shows up as a fixed
 * template rather than requiring an LLM rewrite of the question itself. */
export function candidateQuestionsInvite(pick: () => number, grounding: { orgName: string; jobTitle: string } | null): string {
  const template = CANDIDATE_QUESTIONS_INVITES[Math.floor(pick() * CANDIDATE_QUESTIONS_INVITES.length) % CANDIDATE_QUESTIONS_INVITES.length];
  const roleContext = grounding ? ` about the ${grounding.jobTitle} role at ${grounding.orgName}` : '';
  return template.replace('{{roleContext}}', roleContext);
}

const CANDIDATE_QUESTIONS_ACK = [
  "Good question — I'd encourage you to ask the real interviewer that directly. Let's wrap up.",
  "Noted — that's exactly the kind of thing worth asking a real interviewer. Let's finish up here.",
];

export const CLOSING_MESSAGE =
  "That's everything for this practice session — thanks for working through it with me. " +
  "I'm putting together detailed feedback on each of your answers now; it'll be ready in a moment. " +
  'Nothing here affects your verified skill badges or your match with employers — this is just practice.';

function pickFrom(variants: string[], pick: () => number): string {
  return variants[Math.floor(pick() * variants.length) % variants.length];
}

export function motivationTransition(pick: () => number = Math.random): string {
  return pickFrom(MOTIVATION_TRANSITIONS, pick);
}
export function behavioralTransition(pick: () => number = Math.random): string {
  return pickFrom(BEHAVIORAL_TRANSITIONS, pick);
}
export function industryAwarenessTransition(pick: () => number = Math.random): string {
  return pickFrom(INDUSTRY_TRANSITIONS, pick);
}
export function candidateQuestionsAck(pick: () => number = Math.random): string {
  return pickFrom(CANDIDATE_QUESTIONS_ACK, pick);
}
