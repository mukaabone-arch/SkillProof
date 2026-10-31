import { SkillLevel } from '@prisma/client';

/**
 * Pure halves of GET /interviews/:id/prep — no Prisma, unit-tested in
 * interview-prep.spec.ts. InterviewsService.getPrep loads the rows and
 * hands them here.
 */

export const PREP_CHECKLIST_KEYS = ['reread-job', 'review-results', 'stories', 'questions', 'tech-check'] as const;
export type PrepChecklistKey = (typeof PREP_CHECKLIST_KEYS)[number];

const LEVEL_RANK: Record<SkillLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

export interface JobSkillInput {
  skillId: string;
  skillName: string;
  requiredLevel: SkillLevel;
  isRequired: boolean;
}

/** Highest live (unrevoked, unexpired) MyAmbii badge per skill. */
export interface BadgeInput {
  skillId: string;
  level: SkillLevel;
  sessionId: string | null;
}

export interface ProvenSkill {
  skillId: string;
  skillName: string;
  requiredLevel: SkillLevel;
  level: SkillLevel;
  isRequired: boolean;
  /** From LiveClaimFeedback, discussion-format badges only — empty otherwise. */
  strengths: string[];
  gaps: string[];
}

export interface ProbeSkill {
  skillId: string;
  skillName: string;
  requiredLevel: SkillLevel;
  isRequired: boolean;
  /** Verified below the required level (e.g. L1 when L2 is asked) — null when not verified at all. */
  candidateLevel: SkillLevel | null;
  hasSkillCheck: boolean;
}

/**
 * Splits the job's skills into "you've proven these" (a live badge at or
 * above the required level) and "they'll probe these" (everything else),
 * required skills first in each list. Same at-or-above rule the match
 * scoring uses for full credit.
 */
export function buildSkillPlan(
  jobSkills: JobSkillInput[],
  badges: BadgeInput[],
  coaching: Map<string, { strengths: string[]; gaps: string[] }>,
  skillsWithCheck: Set<string>,
): { proven: ProvenSkill[]; toProbe: ProbeSkill[] } {
  const best = new Map<string, BadgeInput>();
  for (const b of badges) {
    const cur = best.get(b.skillId);
    if (!cur || LEVEL_RANK[b.level] > LEVEL_RANK[cur.level]) best.set(b.skillId, b);
  }

  const proven: ProvenSkill[] = [];
  const toProbe: ProbeSkill[] = [];
  for (const js of jobSkills) {
    const badge = best.get(js.skillId);
    if (badge && LEVEL_RANK[badge.level] >= LEVEL_RANK[js.requiredLevel]) {
      const c = (badge.sessionId && coaching.get(badge.sessionId)) || { strengths: [], gaps: [] };
      proven.push({ ...js, level: badge.level, strengths: c.strengths, gaps: c.gaps });
    } else {
      toProbe.push({ ...js, candidateLevel: badge?.level ?? null, hasSkillCheck: skillsWithCheck.has(js.skillId) });
    }
  }
  const requiredFirst = <T extends { isRequired: boolean }>(a: T, b: T) => Number(b.isRequired) - Number(a.isRequired);
  return { proven: proven.sort(requiredFirst), toProbe: toProbe.sort(requiredFirst) };
}

/**
 * LiveClaimFeedback.strengths/gaps are Json — read defensively: an array of
 * strings, or of { text } objects. Anything else reads as empty.
 */
export function jsonStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    const s = typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string' ? (v as { text: string }).text : null;
    if (s && s.trim()) out.push(s.trim());
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Stable pick of `count` items for one interview: the same entry sees the
 * same questions on every load (no reshuffle on refresh), different
 * entries see different ones.
 */
export function stablePick<T extends { id: string }>(items: T[], seed: string, count: number): T[] {
  const score = (id: string) => {
    let h = 2166136261;
    for (const ch of seed + ':' + id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  return [...items].sort((a, b) => score(a.id) - score(b.id)).slice(0, count);
}

export function formatPlace(p: {
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  locationLegacy: string | null;
}): string | null {
  if (p.locationCity) return [p.locationCity, p.locationRegion, p.locationCountry].filter(Boolean).join(', ');
  return p.locationLegacy || null;
}

/**
 * One quotable line from the job description for the prep plan's "From the
 * job post": the first real responsibility or requirement, never a section
 * heading or a bullet glyph. Job posts are pasted free text (e.g. "Key
 * Responsibilities- • Designing, building…"), so: break on line breaks and
 * bullet characters, strip list markers and "Heading:"/"Heading-" prefixes,
 * skip heading-like pieces, keep the first piece that reads like a sentence
 * (its first sentence, if it has several), and cut at a word boundary.
 */
export function quotableLine(text: string | null | undefined, max: number): string | null {
  const raw = (text ?? '').replace(/\r/g, '');
  if (!raw.trim()) return null;

  const pieces = raw
    .replace(/[•●▪◦‣∙·]/g, '\n')
    .split(/\n+/)
    .map((p) =>
      p
        .replace(/\s+/g, ' ')
        .trim()
        // list markers: "-", "*", "1.", "a)", "(2)"
        .replace(/^(?:[-–—*]+|\(?\d{1,2}[.)]|\(?[a-z][.)])\s*/i, '')
        // "Key Responsibilities -" / "Requirements:" prefix on the same line as real text
        .replace(/^[A-Z][A-Za-z &/]{2,40}\s?[:\-–—]\s+(?=\S)/, '')
        .trim(),
    )
    .filter(Boolean);

  const isHeading = (p: string) =>
    /[:\-–—]$/.test(p) || (p.split(' ').length <= 4 && !/[.,;]/.test(p));

  const pick = pieces.find((p) => !isHeading(p) && p.split(' ').length >= 5);
  if (!pick) return null;

  // First sentence only, when there's a full one of reasonable length.
  const sentence = /^(.{40,}?[.!?])\s/.exec(pick + ' ');
  let line = (sentence ? sentence[1] : pick).replace(/[\s,;:\-–—]+$/, '');

  if (line.length > max) {
    const cut = line.slice(0, max);
    const at = cut.lastIndexOf(' ');
    line = (at > 0 ? cut.slice(0, at) : cut).replace(/[\s,;:\-–—]+$/, '') + '…';
  }
  return line;
}
