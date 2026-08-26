import { OrgIndustry } from './orgIndustry';

/**
 * Mirrors the server's org-setup-completeness rule (see apps/api's
 * org-readiness.ts). Used only to decide what to show here — redirecting
 * to /employer/setup or ticking off a checklist item is a UX courtesy,
 * OrgSetupCompleteGuard enforces the actual gate server-side regardless.
 * Single shared copy so app/employer/layout.tsx and
 * app/employer/setup/page.tsx can't drift apart on what "complete" means.
 */
export interface OrgReadinessFields {
  hasLogo: boolean;
  industry: OrgIndustry | null;
  industryOther: string | null;
  website: string | null;
}

/** OTHER with no (or blank) industryOther doesn't count as set — same reasoning as the API's UpdateOrgDto @ValidateIf on industryOther. */
export function isIndustryComplete(org: Pick<OrgReadinessFields, 'industry' | 'industryOther'>): boolean {
  if (org.industry == null) return false;
  if (org.industry === 'OTHER') return !!org.industryOther?.trim();
  return true;
}

export function isOrgSetupComplete(org: OrgReadinessFields): boolean {
  return org.hasLogo && isIndustryComplete(org) && !!org.website;
}
