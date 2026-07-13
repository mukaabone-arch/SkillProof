import { NameMatchState } from '@prisma/client';

/** lowercase, strip accents/punctuation, collapse whitespace, split into tokens */
export function normalizeNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Token-overlap heuristic, tolerant of initials and inserted middle/nicknames
 * ("A.S. Hurzuk" vs "Abdul Salam Hurzuk", "Bob Smith" vs "Robert Bob Smith").
 * Takes the smaller token set as the basis (subset check) and requires most
 * of its tokens to appear in the larger set, either verbatim or as an
 * initial-vs-full-token match on either side.
 */
export function namesLikelyMatch(a: string, b: string): boolean {
  const tokensA = normalizeNameTokens(a);
  const tokensB = normalizeNameTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];

  const isInitialOf = (initial: string, full: string) => initial.length === 1 && full.startsWith(initial);

  const matches = (token: string) =>
    larger.has(token) ||
    [...larger].some((other) => isInitialOf(token, other) || isInitialOf(other, token));

  const overlap = [...smaller].filter(matches).length;
  return overlap / smaller.size >= 0.6;
}

/** UNCHECKED whenever either name is missing — never blocks, never guesses. */
export function computeNameMatchState(
  holderName: string | null | undefined,
  profileFullName: string | null | undefined,
): NameMatchState {
  if (!holderName?.trim() || !profileFullName?.trim()) return NameMatchState.UNCHECKED;
  return namesLikelyMatch(holderName, profileFullName) ? NameMatchState.MATCH : NameMatchState.MISMATCH;
}
