import { createHash } from 'crypto';
import type { HelpAudienceKey } from './help-assistant.dto';

/**
 * The pre-built answer library: questions Claude drafted from each guide
 * offline (scripts/build-help-library.ts), reviewed and committed as
 * help-library.generated.ts. A first question that matches an entry closely
 * enough is answered from here, with no AI call. Each audience's entries
 * carry the hash of the guide they were written from; when the guide
 * changes, that audience's library is ignored until it is rebuilt, so a
 * stale answer can never be served.
 */
export interface HelpLibraryEntry {
  id: string;
  question: string;
  variants: string[];
  answer: string;
  sectionIds: string[];
}

export interface HelpLibrary {
  guideHash: string;
  entries: HelpLibraryEntry[];
}

export type HelpLibraries = Partial<Record<HelpAudienceKey, HelpLibrary>>;

/** Short, stable fingerprint of a guide's text. */
export function guideHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex').slice(0, 16);
}

const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at by for from with about into over as is are was were be been being ' +
    'do does did doing have has had having i me my mine we our us you your it its this that these those there here ' +
    'what which who whom how when where why can could should would will shall may might must please pls plz hi hello ' +
    'hey thanks thank just get got go going any some all also am im i\'m myambii'
  ).split(/\s+/),
);

/** Lowercase, letters and digits only, light stemming, no filler words. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
    .map(stem);
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('es') && !t.endsWith('ses')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** Normalised form used as the answer-cache key: same words, same order, nothing else. */
export function normalizeQuestion(text: string): string {
  return tokens(text).join(' ');
}

/** A match must be at least this similar (cosine, 0–1)… */
export const MATCH_THRESHOLD = 0.72;
/** …and this much better than the best different entry, or it's too close to call… */
export const MATCH_MARGIN = 0.06;
/** …and the phrasing must contain at least this share of the question's (weighted) words. */
export const MIN_COVERAGE = 0.75;

interface Phrasing {
  entry: HelpLibraryEntry;
  vector: Map<string, number>;
  norm: number;
}

export interface LibraryMatch {
  entry: HelpLibraryEntry;
  score: number;
}

/** TF-IDF cosine over every phrasing (question + variants) of one audience's entries. */
export class HelpLibraryMatcher {
  private readonly phrasings: Phrasing[] = [];
  private readonly idf = new Map<string, number>();
  /** Weight of a word the library never uses — rarer than any word it does. */
  private unknownWeight = 0;

  constructor(entries: HelpLibraryEntry[]) {
    const docs = entries.flatMap((entry) => [entry.question, ...entry.variants].map((text) => ({ entry, toks: tokens(text) })));
    const df = new Map<string, number>();
    for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) ?? 0) + 1);
    for (const [t, n] of df) this.idf.set(t, Math.log(1 + docs.length / n));
    this.unknownWeight = Math.log(1 + docs.length);
    for (const d of docs) {
      if (!d.toks.length) continue;
      const vector = this.vectorize(d.toks);
      this.phrasings.push({ entry: d.entry, vector, norm: norm(vector) });
    }
  }

  get size(): number {
    return this.phrasings.length;
  }

  private vectorize(toks: string[]): Map<string, number> {
    const v = new Map<string, number>();
    for (const t of toks) v.set(t, (v.get(t) ?? 0) + (this.idf.get(t) ?? 0));
    return v;
  }

  /** The best entry if it clears the threshold and margin; otherwise null (go live). */
  match(question: string): LibraryMatch | null {
    const toks = tokens(question);
    // A word the library never uses counts fully against every match: it is
    // usually what the question is really about ("let RECRUITERS find me"
    // must not match "find jobs").
    const unknown = toks.filter((t) => !this.idf.has(t)).length;
    const q = this.vectorize(toks);
    const qNorm = Math.sqrt(norm(q) ** 2 + unknown * this.unknownWeight ** 2);
    if (!qNorm || toks.length - unknown < 1) return null;

    const qMass = [...q.values()].reduce((a, w) => a + w, 0) + unknown * this.unknownWeight;
    const best = new Map<string, LibraryMatch>();
    for (const p of this.phrasings) {
      let dot = 0;
      let covered = 0;
      for (const [t, w] of q) {
        const pw = p.vector.get(t);
        if (pw === undefined) continue;
        dot += w * pw;
        covered += w;
      }
      // Similar overall isn't enough: the words that make the question
      // specific have to be there too.
      if (covered / qMass < MIN_COVERAGE) continue;
      const score = dot / (qNorm * p.norm);
      const prev = best.get(p.entry.id);
      if (!prev || score > prev.score) best.set(p.entry.id, { entry: p.entry, score });
    }
    const ranked = [...best.values()].sort((a, b) => b.score - a.score);
    const [top, second] = ranked;
    if (!top || top.score < MATCH_THRESHOLD) return null;
    if (second && top.score - second.score < MATCH_MARGIN && top.entry.answer !== second.entry.answer) return null;
    return top;
  }
}

function norm(v: Map<string, number>): number {
  let s = 0;
  for (const w of v.values()) s += w * w;
  return Math.sqrt(s);
}

/** Questions carrying something personal (a number, an email) are never cached for others. */
export function looksPersonal(question: string): boolean {
  return /\d{4,}|@/.test(question);
}
