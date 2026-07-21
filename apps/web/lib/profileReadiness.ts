/**
 * Mirrors the server's assessment-start profile-readiness rule (see
 * apps/api/src/modules/profiles/profile-readiness.ts). Used only to decide
 * what to show here — disabling a Start button is a UX courtesy, the server
 * enforces the actual gate (PROFILE_INCOMPLETE_FOR_ASSESSMENT) regardless.
 */
export interface ProfileReadinessFields {
  fullName: string | null;
  headline: string | null;
  yearsOfExp: number | null;
}

export type MissingReadinessField = 'name' | 'headline' | 'role';

export function missingReadinessFields(profile: ProfileReadinessFields): MissingReadinessField[] {
  const missing: MissingReadinessField[] = [];
  if (!profile.fullName?.trim()) missing.push('name');
  if (!profile.headline?.trim() && profile.yearsOfExp == null) missing.push('headline', 'role');
  return missing;
}

export function isProfileReadyForAssessment(profile: ProfileReadinessFields): boolean {
  return missingReadinessFields(profile).length === 0;
}

const FIELD_LABEL: Record<MissingReadinessField, string> = {
  name: 'your name',
  headline: 'a headline',
  role: 'your years of experience',
};

/** Friendly "Add X and Y to..." sentence built from whichever fields are actually missing. */
export function readinessGateMessage(missing: MissingReadinessField[]): string {
  const unique = Array.from(new Set(missing));
  if (unique.length === 0) return '';
  const labels = unique.map((m) => FIELD_LABEL[m]);
  const joined =
    labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0];
  return `Add ${joined} to start earning verified badges.`;
}
