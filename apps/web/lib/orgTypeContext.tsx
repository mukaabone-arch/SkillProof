'use client';

/**
 * The signed-in organisation's type, for pages inside the employer layout
 * that differ for recruiters (STAFFING) — e.g. Job Postings and Projects,
 * where a recruiter posts for a client. The layout already reads the type
 * from /orgs/me and keeps it current (orgTypeBus), so it provides it here
 * instead of every page fetching /orgs/me again. Defaults to EMPLOYER.
 */
import { createContext, useContext } from 'react';
import type { OrgType } from './orgTypeBus';

const OrgTypeContext = createContext<OrgType>('EMPLOYER');

export const OrgTypeProvider = OrgTypeContext.Provider;

export function useOrgType(): OrgType {
  return useContext(OrgTypeContext);
}
