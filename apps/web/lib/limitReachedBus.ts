/**
 * Tiny pub-sub so lib/api.ts (a plain fetch wrapper, no React) can notify a
 * React-rendered upgrade prompt without importing React. api.ts publishes
 * here the moment it sees a 402 { code: 'LIMIT_REACHED', ... } response,
 * from any call site — LimitReachedModal (mounted once, in the app's root
 * providers) is the sole subscriber and is what actually renders the
 * prompt. This is what "handle 402 centrally" means in practice: no
 * individual component ever needs to check for this shape itself.
 */
export interface LimitReachedPayload {
  metric: string;
  limit: number | null;
  /** ISO string, or null for a lifetime cap (no reset — see retakesPerSkillLifetime). */
  resetsAt: string | null;
}

type Listener = (payload: LimitReachedPayload) => void;

const listeners = new Set<Listener>();

export function onLimitReached(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLimitReached(payload: LimitReachedPayload): void {
  listeners.forEach((listener) => listener(payload));
}
