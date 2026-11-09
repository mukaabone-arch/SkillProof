/**
 * Where a person lands after choosing "Log out" themselves: the marketing
 * landing page, which shows a short "You've signed out" note (see
 * components/SignedOutNotice.tsx) and lets them pick candidate, employer or
 * recruiter again. Only for a deliberate log-out — an expired session, a
 * deactivation or an account deletion keeps its own destination.
 */
export const SIGNED_OUT_PARAM = 'signedOut';
export const SIGNED_OUT_URL = `/?${SIGNED_OUT_PARAM}=1`;
