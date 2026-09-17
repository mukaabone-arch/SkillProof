/**
 * Human names for the internal L1–L4 skill-level codes. First decided in
 * app/assessments/page.tsx's own LEVEL_INFO (the assessment catalog, where a
 * first-time candidate first meets "L1") — this module exists so every other
 * candidate-facing surface that mentions a level (the Jobs list and job
 * detail page, so far) reuses the same three words instead of inventing its
 * own. Deliberately not wired back into assessments/page.tsx's own LEVEL_INFO
 * in this pass — that file also carries a description per level this module
 * has no use for, and it isn't broken today; only new call sites import this.
 *
 * L4 ('Expert') is carried for completeness (the Skill/Badge model goes up to
 * L4) even though the Jobs page's own apply-gate is L1–L3 scoped.
 */
export type SkillLevelCode = 'L1' | 'L2' | 'L3' | 'L4';

const SKILL_LEVEL_NAMES: Record<SkillLevelCode, string> = {
  L1: 'Foundational',
  L2: 'Practitioner',
  L3: 'Advanced',
  L4: 'Expert',
};

/** Falls back to the raw code for anything outside L1–L4 — defensive only; every current caller already restricts itself to that set. */
export function skillLevelName(level: string): string {
  return SKILL_LEVEL_NAMES[level as SkillLevelCode] ?? level;
}
