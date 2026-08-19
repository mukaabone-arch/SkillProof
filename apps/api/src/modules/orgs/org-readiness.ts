import { BadRequestException } from '@nestjs/common';

/**
 * Single source of truth for "has this organisation completed its required
 * profile" — same role for employers as profiles/profile-readiness.ts plays
 * for candidates, and deliberately built the same shape (missing* /
 * isReady* / assert*) so the two gates can never drift apart in structure.
 * Enforced by OrgSetupCompleteGuard on every employer-portal route except
 * the ones that let an org actually comply (OrgsController — org info/logo
 * edit) and team management (OrgMembersController — team invitations are
 * explicitly NOT part of this gate; see DashboardService.setupChecklist's
 * own doc comment for that separate, optional nudge).
 */
export interface OrgReadinessFields {
  logoKey: string | null;
  industry: string | null;
  website: string | null;
}

export type MissingOrgSetupField = 'logo' | 'industry' | 'website';

export function missingOrgSetupFields(org: OrgReadinessFields): MissingOrgSetupField[] {
  const missing: MissingOrgSetupField[] = [];
  if (org.logoKey == null) missing.push('logo');
  if (!org.industry?.trim()) missing.push('industry');
  if (!org.website?.trim()) missing.push('website');
  return missing;
}

export function isOrgSetupComplete(org: OrgReadinessFields): boolean {
  return missingOrgSetupFields(org).length === 0;
}

/**
 * Thrown by OrgSetupCompleteGuard — `code` follows the same machine-readable
 * convention as PROFILE_INCOMPLETE/PROFILE_INCOMPLETE_FOR_ASSESSMENT/
 * LIMIT_REACHED, so the client can render the right screen off `code` alone.
 * `missing` rides along on the error body for the same reason
 * profile-readiness's assert functions include it — the client shouldn't
 * have to re-derive which fields are absent from a plain message string.
 */
export function assertOrgSetupComplete(org: OrgReadinessFields): void {
  const missing = missingOrgSetupFields(org);
  if (missing.length === 0) return;

  throw new BadRequestException({
    code: 'ORG_SETUP_INCOMPLETE',
    message: 'Complete your organisation profile (logo, industry, and website) before using the employer portal.',
    missing,
  });
}
