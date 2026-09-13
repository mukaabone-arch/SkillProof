import { SkillLevel } from '@prisma/client';

/**
 * The apply gate requires currently-valid badges at every one of these
 * levels, all for the same skill. Pinned explicitly rather than derived from
 * SkillLevel/LEVEL_ORDER — that enum includes L4, which has no live content
 * today (see SkillLevel's own schema doc comment: every skill's live
 * assessment catalog stops at L3) and must never be demanded by this gate.
 * If L4 content ever ships, this array is the one place to reconsider —
 * the enum itself stays untouched.
 */
export const APPLY_GATE_REQUIRED_LEVELS: SkillLevel[] = [SkillLevel.L1, SkillLevel.L2, SkillLevel.L3];
