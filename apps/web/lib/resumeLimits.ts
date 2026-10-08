/**
 * The resume builder's skills field: capped so a one-page PDF can show every
 * entry legibly. This is a presentation limit, not a security bound — see
 * CandidatePortfolio's doc comment in schema.prisma for how this relates to
 * the portfolio's own, much larger, "everything the candidate has" cap.
 *
 * 30, not 60: measured with pdfkit's own heightOfString against the real
 * layout in resume-pdf.builder.ts (Helvetica 9.5pt, A4 content width), the
 * "Skills" block — one run-on, dot-separated line that wraps — comes out to:
 *
 *   25 skills: ~5 wrapped lines (~52pt, ~7% of the one-page budget)
 *   30 skills: ~5 wrapped lines (~52pt, ~7%)
 *   60 skills: ~11 wrapped lines (~117pt, ~16%)
 *   85 skills: ~14 wrapped lines (~156pt, ~21% — the production case that
 *              triggered this fix: one CandidatePortfolio, 9 groups, 85
 *              skills flattened, parsed 2026-10-08T04:48:20Z)
 *
 * 60 reads as an unreadable block competing with Experience for space; 30
 * reads like a normal resume's skills line. The candidate chooses which
 * skills make that cut (see the resume page's group selector) — this isn't
 * meant to be reached by typing past it blind.
 *
 * Mirrors GenerateResumeDto.skills's @ArrayMaxSize/@MaxLength in
 * apps/api/src/modules/profiles/profiles.dto.ts. Duplicated rather than
 * shared: apps/web and apps/api are separate deployables with no package
 * between them to import from (same reasoning as LEVEL_NAME in
 * apps/api/src/modules/jobs/candidate-jobs.service.ts, mirroring
 * apps/web/lib/skillLevels.ts) — kept in step by comment, not by import.
 * Enforced here before the candidate can submit, so the 400 the DTO would
 * otherwise return never reaches them.
 */
export const RESUME_SKILLS_MAX = 30;
export const RESUME_SKILL_MAX_LENGTH = 60;
