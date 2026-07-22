import { SkillLevel } from '@prisma/client';

/**
 * Deterministic candidate ↔ job scoring. Pure functions, no I/O — the AI
 * explanation layer (LlmService.explainMatch) only narrates this output, it
 * never influences the numbers.
 *
 * Inputs are deliberately limited to verified SkillClaims/Badges, verified
 * Certification skill tags, and yearsOfExp — see scoreCandidate's signature
 * below. NEVER add CandidateProfile.roleTitle, headline, location, fullName,
 * or any other self-reported/unverified profile text field as a scoring
 * input. roleTitle in particular exists purely for display and employer
 * search/filter (see its doc comment in schema.prisma) — it carries no
 * verification and must never influence a match score, no matter how
 * tempting a "boost exact role matches" feature sounds later.
 *
 * certifiedSkillIds (added alongside the Certification model) is held to
 * the exact same bar: only Skill.id values backed by a currently-VERIFIED,
 * non-expired Certification may ever be passed in — see
 * MatchingService.getMatches for where that set is built. LINK_PROVIDED and
 * SELF_REPORTED certification tags must never reach this function; they're
 * unverified in the same sense roleTitle is, just via a different pathway.
 */

export interface JobSkillRequirement {
  skillId: string;
  skillName: string;
  requiredLevel: SkillLevel;
  isRequired: boolean;
}

export interface CandidateSkillClaim {
  skillId: string;
  level: SkillLevel;
  /** true only for a currently-VERIFIED claim; EXPIRED counts as unverified. */
  verified: boolean;
}

export interface SkillMatchDetail {
  skillId: string;
  skillName: string;
  requiredLevel: SkillLevel;
  isRequired: boolean;
  candidateLevel: SkillLevel | null;
  verified: boolean;
  /** The 0..1 credit this skill contributed before weighting. */
  creditFraction: number;
}

export interface CandidateScoreResult {
  /** 0–100 integer. */
  score: number;
  /** Skills where the candidate has a verified claim at/above the required level. */
  matched: SkillMatchDetail[];
  /** Required skills that fell short of full verified credit (no claim, unverified, or below level). */
  missing: SkillMatchDetail[];
}

const LEVEL_ORDINAL: Record<SkillLevel, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

/** isRequired job skills count double an optional one — see task spec. */
export const REQUIRED_WEIGHT = 2;
export const OPTIONAL_WEIGHT = 1;

const UNVERIFIED_AT_OR_ABOVE_LEVEL_CREDIT = 0.4;
const UNVERIFIED_BELOW_LEVEL_CREDIT = 0.2;

/**
 * Per-skill credit fraction (0..1) for one job requirement:
 *
 *   no claim at all                 → 0
 *   verified,  level >= required    → 1.0   (full credit)
 *   verified,  level <  required    → level / required   (scaled by how close)
 *   unverified, level >= required   → 0.4   (counts partially)
 *   unverified, level <  required   → 0.2   (small credit)
 *
 * Core invariant — a VERIFIED claim must always outscore an UNVERIFIED claim
 * at the same level. This holds across every level combination:
 *   - at/above the required level: verified is always capped at 1.0, which
 *     beats the unverified at/above credit of 0.4.
 *   - below the required level: the worst-case verified score is 1/4 = 0.25
 *     (an L1 claim against an L4 requirement) — still above the unverified
 *     below-level credit of 0.2. Verified quality never loses to an
 *     unverified claim at the same (or any) level.
 */
function scoreSkill(requiredLevel: SkillLevel, claim: CandidateSkillClaim | undefined): number {
  if (!claim) return 0;

  const required = LEVEL_ORDINAL[requiredLevel];
  const actual = LEVEL_ORDINAL[claim.level];
  const meetsLevel = actual >= required;

  if (claim.verified) {
    return meetsLevel ? 1.0 : actual / required;
  }
  return meetsLevel ? UNVERIFIED_AT_OR_ABOVE_LEVEL_CREDIT : UNVERIFIED_BELOW_LEVEL_CREDIT;
}

/**
 * A verified certification has no L1-L4 level of its own (see
 * Certification's doc comment) — holding one is treated as satisfying any
 * required level outright, the same way a curated external credential would
 * in a human reviewer's judgment. This can only ever raise a skill's credit
 * fraction, never lower it: it's applied as a floor in scoreCandidate below
 * a SkillClaim-derived creditFraction, not a replacement for it.
 */
const CERTIFIED_CREDIT = 1.0;

const EXPERIENCE_BONUS = 5;
const EXPERIENCE_PENALTY = 5;
const WELL_BELOW_YEARS = 2;

/**
 * A minor ±5-point nudge on top of the 0-100 skill score — experience is
 * explicitly a secondary signal, never the deciding factor.
 *   - yearsOfExp within [experienceMin, experienceMax] → +5
 *   - yearsOfExp more than 2 years under experienceMin → -5 ("well below")
 *   - anything else (including no experience range set, or missing data)  → 0
 */
function experienceAdjustment(
  yearsOfExp: number | null,
  experienceMin: number | null,
  experienceMax: number | null,
): number {
  if (yearsOfExp == null) return 0;
  if (experienceMin == null && experienceMax == null) return 0;

  const aboveMin = experienceMin == null || yearsOfExp >= experienceMin;
  const belowMax = experienceMax == null || yearsOfExp <= experienceMax;
  if (aboveMin && belowMax) return EXPERIENCE_BONUS;

  if (experienceMin != null && yearsOfExp < experienceMin - WELL_BELOW_YEARS) {
    return -EXPERIENCE_PENALTY;
  }
  return 0;
}

/**
 * Scores one candidate against one job's skill requirements.
 *
 * score = round(clamp(weighted skill percentage + experience adjustment, 0, 100))
 * weighted skill percentage = 100 * (Σ creditFraction·weight) / (Σ weight)
 *
 * certifiedSkillIds: Skill.id values backed by a VERIFIED, non-expired
 * Certification (see this file's header comment) — pass an empty set from
 * any call site that hasn't fetched certifications, never a set built from
 * LINK_PROVIDED/SELF_REPORTED rows.
 */
export function scoreCandidate(
  jobSkills: JobSkillRequirement[],
  claimsBySkillId: Map<string, CandidateSkillClaim>,
  certifiedSkillIds: ReadonlySet<string>,
  yearsOfExp: number | null,
  experienceMin: number | null,
  experienceMax: number | null,
): CandidateScoreResult {
  let weightedSum = 0;
  let maxPossible = 0;
  const matched: SkillMatchDetail[] = [];
  const missing: SkillMatchDetail[] = [];

  for (const req of jobSkills) {
    const claim = claimsBySkillId.get(req.skillId);
    const certified = certifiedSkillIds.has(req.skillId);
    const creditFraction = Math.max(scoreSkill(req.requiredLevel, claim), certified ? CERTIFIED_CREDIT : 0);
    const weight = req.isRequired ? REQUIRED_WEIGHT : OPTIONAL_WEIGHT;

    weightedSum += creditFraction * weight;
    maxPossible += weight;

    const detail: SkillMatchDetail = {
      skillId: req.skillId,
      skillName: req.skillName,
      requiredLevel: req.requiredLevel,
      isRequired: req.isRequired,
      candidateLevel: claim?.level ?? null,
      verified: (claim?.verified ?? false) || certified,
      creditFraction,
    };

    if (creditFraction >= 1) {
      matched.push(detail);
    } else if (req.isRequired) {
      missing.push(detail);
    }
  }

  const skillPercent = maxPossible > 0 ? (weightedSum / maxPossible) * 100 : 0;
  const adjusted = skillPercent + experienceAdjustment(yearsOfExp, experienceMin, experienceMax);
  const score = Math.max(0, Math.min(100, Math.round(adjusted)));

  return { score, matched, missing };
}
