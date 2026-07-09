/**
 * Single source of truth for "is this profile complete enough to apply" —
 * used both to enforce it (CandidateJobsService.apply) and to explain a
 * pre-existing gap to employers (JobsService.getApplicants), so the two can
 * never disagree about what "incomplete" means.
 */
export function isProfileReadyToApply(profile: {
  fullName: string | null;
  headline: string | null;
  yearsOfExp: number | null;
}): boolean {
  const hasName = !!profile.fullName?.trim();
  const hasHeadlineOrExperience = !!profile.headline?.trim() || profile.yearsOfExp != null;
  return hasName && hasHeadlineOrExperience;
}
