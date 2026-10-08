/**
 * Human names for the internal L1–L4 skill-level codes. Mirrors
 * apps/web/lib/skillLevels.ts — keep the two in step. Lives here (not in
 * candidate-jobs.service.ts) so every server-side string that mentions a
 * level (the apply-gate rejection, the entitlements progress display) reads
 * from one map instead of each module keeping its own copy.
 *
 * L4 ('Expert') is carried for completeness even though the apply gate is
 * L1–L3 scoped (see apply-gate.config.ts).
 */
export const SKILL_LEVEL_NAME: Record<string, string> = {
  L1: 'Foundational',
  L2: 'Practitioner',
  L3: 'Advanced',
  L4: 'Expert',
};
