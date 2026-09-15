/**
 * Tiny pub-sub so lib/api.ts (a plain fetch wrapper, no React) can notify a
 * React-rendered "assessments are paused" prompt without importing React —
 * same shape as limitReachedBus.ts. api.ts publishes here the moment it sees
 * a 403 { code: 'ASSESSMENT_BLOCKED', ... } response, from any call site —
 * AssessmentBlockedModal (mounted once, in the app's root providers) is the
 * sole subscriber and is what actually renders the prompt.
 */
export interface AssessmentBlockedPayload {
  /** ISO string — when the block lifts. Always shown as a resolved timestamp, never a relative duration like "24 hours". */
  expiresAt: string;
}

type Listener = (payload: AssessmentBlockedPayload) => void;

const listeners = new Set<Listener>();

export function onAssessmentBlocked(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitAssessmentBlocked(payload: AssessmentBlockedPayload): void {
  listeners.forEach((listener) => listener(payload));
}
