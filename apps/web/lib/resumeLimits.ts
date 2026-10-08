/**
 * The resume builder's skills field: one comma-separated input, capped so a
 * one-page PDF can show every entry legibly. This is a presentation limit,
 * not a security bound.
 *
 * Mirrors GenerateResumeDto.skills's @ArrayMaxSize/@MaxLength in
 * apps/api/src/modules/profiles/profiles.dto.ts. Duplicated rather than
 * shared: apps/web and apps/api are separate deployables with no package
 * between them to import from (same reasoning as LEVEL_NAME in
 * apps/api/src/modules/jobs/candidate-jobs.service.ts, mirroring
 * apps/web/lib/skillLevels.ts) — kept in step by comment, not by import.
 * Enforced here before the candidate can submit, so the 400 the DTO would
 * otherwise return never reaches them.
 *
 * Deliberately not reconciled with PortfolioSkillGroupDto's 40-per-group cap
 * (up to 20 groups, so up to 800 skills in a portfolio) — a verified
 * portfolio can exceed this resume limit, and resume generation does not
 * currently reject or truncate on that account. Flagged for a product
 * decision, not fixed here: see profiles.dto.ts's comment on
 * GenerateResumeDto.skills.
 */
export const RESUME_SKILLS_MAX = 60;
export const RESUME_SKILL_MAX_LENGTH = 60;
