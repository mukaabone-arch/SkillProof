/**
 * Tiny pub-sub, same shape as limitReachedBus.ts/candidateVerificationBus.ts,
 * so lib/api.ts's candidate client can notify listeners the instant
 * setTokens()/clearTokens() runs — a login or logout is a state change, not
 * a mount, and nothing about it otherwise touches the component tree (no
 * route change, no prop, no dependency array a React effect could key off
 * of) when it happens client-side without a page load. Candidate-scope
 * only: the employer client (lib/api.ts's employerApi) intentionally does
 * not wire this up, since nothing in the candidate app needs to react to an
 * employer-portal login.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onCandidateTokenChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitCandidateTokenChange(): void {
  listeners.forEach((listener) => listener());
}
