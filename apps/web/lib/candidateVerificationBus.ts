/**
 * Tiny pub-sub so lib/api.ts (a plain fetch wrapper, no React) can notify
 * CandidateVerificationProvider without importing React — same reasoning
 * and shape as limitReachedBus.ts. api.ts publishes here the moment it
 * sees a 400 { code: 'CANDIDATE_VERIFICATION_INCOMPLETE' } response, from
 * ANY call site, ANY page. This is the defense-in-depth path: even if the
 * provider's own proactive /users/me check has a gap, any actual 400 with
 * this code from any endpoint is itself definitive proof and triggers the
 * same block+redirect the proactive check would have. No payload — unlike
 * limit-reached, there's nothing to display beyond "go to /verify", and
 * the provider already knows how to get full status via refetch() if it
 * ever needs it.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onCandidateVerificationIncomplete(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitCandidateVerificationIncomplete(): void {
  listeners.forEach((listener) => listener());
}
