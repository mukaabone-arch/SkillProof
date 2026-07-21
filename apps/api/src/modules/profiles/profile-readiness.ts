import { BadRequestException } from '@nestjs/common';

/**
 * Single source of truth for "is this profile real enough to act on" — used
 * to enforce job applications (CandidateJobsService.apply), assessment
 * starts (AssessmentsService.startAttempt / AssessmentSessionsService.
 * createSession), and to explain a pre-existing gap to employers
 * (JobsService.getApplicants), so none of these can ever disagree about what
 * "incomplete" means. Deliberately excludes githubUrl/linkedinUrl and the
 * CandidateProfile.completeness percentage entirely — those are
 * employer-richness signals, not proof a candidate is a real, identifiable
 * person ready to apply or be evaluated (completeness is 7 equally-weighted
 * fields with achievable values 0/14/29/43/57/71/86/100, so no threshold near
 * "75%" is both reachable and meaningful without also forcing a social link).
 */
export interface ProfileReadinessFields {
  fullName: string | null;
  headline: string | null;
  yearsOfExp: number | null;
}

export type MissingReadinessField = 'name' | 'headline' | 'role';

/**
 * Which specific piece(s) are missing, for client-facing "add X" copy.
 * `headline` and `role` (yearsOfExp) are an OR pair in the underlying rule —
 * they only appear together when neither is present, since either one alone
 * already satisfies the requirement.
 */
export function missingReadinessFields(profile: ProfileReadinessFields): MissingReadinessField[] {
  const missing: MissingReadinessField[] = [];
  if (!profile.fullName?.trim()) missing.push('name');
  if (!profile.headline?.trim() && profile.yearsOfExp == null) missing.push('headline', 'role');
  return missing;
}

export function isProfileReadyToApply(profile: ProfileReadinessFields): boolean {
  return missingReadinessFields(profile).length === 0;
}

/**
 * Assessment-start gate shared by both start paths (AssessmentsService.
 * startAttempt, AssessmentSessionsService.createSession) — same underlying
 * readiness rule as isProfileReadyToApply, thrown with its own `code` so the
 * client can tell this apart from the job-apply PROFILE_INCOMPLETE case and
 * point at the right next step. `missing` rides along on the error body (not
 * just the message) so the client can render exactly what's absent.
 */
export function assertProfileReadyForAssessment(profile: ProfileReadinessFields): void {
  const missing = missingReadinessFields(profile);
  if (missing.length === 0) return;

  const needsName = missing.includes('name');
  const needsHeadlineOrRole = missing.includes('headline');

  const message = needsName && needsHeadlineOrRole
    ? 'Add your name and either a headline or years of experience to start earning verified badges.'
    : needsName
      ? 'Add your name to start earning verified badges.'
      : 'Add a headline or your years of experience to start earning verified badges.';

  throw new BadRequestException({
    code: 'PROFILE_INCOMPLETE_FOR_ASSESSMENT',
    message,
    missing,
  });
}
