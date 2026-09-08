'use client';

/**
 * Shared shell for every employer route. Auth-gating is centralized here
 * instead of duplicated per-page (the old pattern — see git history on
 * /employer/shortlist and /employer/dashboard, which each ran their own
 * getToken() check-and-redirect before this layout existed). The root
 * /employer route is the one exception: it renders the OTP login itself
 * for anonymous visitors, so it manages its own status and is rendered
 * bare here, with no sidebar.
 *
 * Also gates on organisation-setup completeness (logo/industry/website) and,
 * separately, on platform-admin verification (verificationStatus ===
 * VERIFIED) — both UX convenience only, mirroring but not replacing
 * OrgSetupCompleteGuard/OrgVerifiedGuard's real, server-side enforcement
 * (see apps/api's org-readiness.ts and org-verified.guard.ts). Every
 * employer-portal page depends on both checks, so they belong here rather
 * than duplicated per-page, same reasoning as the auth check above.
 * SETUP_EXEMPT_PATHS doubles as the verification-exempt list too — both
 * gates carve out the exact same two paths, for the same reason: setup
 * (nowhere else to send an incomplete org) and settings (where an org
 * fixes itself, checks its verification status, and where team management
 * lives — OrgsController and OrgMembersController are both ungated by
 * either guard). Must stay in sync with which controllers
 * OrgSetupCompleteGuard/OrgVerifiedGuard are (and aren't) attached to on
 * the API side.
 *
 * The verification check runs only once the setup check has already
 * passed (or the path is exempt) — an org that isn't setup-complete is
 * still sent to /employer/setup first, same as before this gate existed;
 * completing setup auto-submits for verification server-side (see
 * OrgsService.maybeAutoSubmitForVerification), so by the time an org would
 * otherwise clear the setup check it's already PENDING, not UNVERIFIED.
 *
 * Deactivation is checked in the same GET /orgs/me fetch, ahead of the
 * setup check — an org can be both incomplete AND deactivated (unlikely
 * in practice, but deactivation is the more urgent fact to show). Unlike
 * setup, deactivation has NO exempt paths beyond the explanation screen
 * itself: there's no self-service fix (see apps/api's OrgActiveGuard),
 * so /employer/settings — where the setup gate's own exemption lives, for
 * an org that still needs to fix itself — does not get the same
 * exemption here. GET /orgs/me itself stays reachable for a deactivated
 * org purely because it bypasses OrgMemberGuard entirely (its own manual
 * membership lookup, not @UseGuards(OrgMemberGuard)) — see that
 * controller method's own comment — which is what lets this check run at
 * all instead of every request just 403ing.
 */
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import EmployerSidebarShell from '@/components/EmployerSidebarShell';
import { isOrgSetupComplete, OrgReadinessFields } from '@/lib/orgReadiness';

const { getToken, api } = employerApi;

const SETUP_EXEMPT_PATHS = ['/employer/setup', '/employer/settings'];
const DEACTIVATED_EXEMPT_PATHS = ['/employer/deactivated'];

type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

interface OrgMeOrganization extends OrgReadinessFields {
  deactivatedAt: string | null;
  verificationStatus: VerificationStatus;
}

export default function EmployerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Deliberately does NOT reset to false at the top of the effect below on
  // every pathname change (2026-09 fix — see git history for the one-line
  // diff this replaced). This check re-runs on every navigation regardless
  // — see the effect body — but it's re-verifying an org-level fact that's
  // essentially never going to have flipped between two clicks in the same
  // session; forcing `ready` back to false first, before that re-check
  // resolves, means this component renders null and tears down
  // EmployerSidebarShell (and, with it, the page content already correctly
  // mounted for the new route) purely to redraw the *identical* tree a
  // moment later. That's a genuine unmount+remount every single tab
  // switch, not a cosmetic flicker: it's what was surfacing as the visible
  // blink in the content area, and it's *why* every page's own mount-time
  // fetch (taxonomy, shortlist, ...) was firing twice — the page component
  // was genuinely mounting twice, once discarded a moment after. Now
  // `ready` only ever goes false->true once per session; the re-check
  // still runs and still redirects (to /employer/setup, /employer/deactivated,
  // or /employer on a missing token) if it finds something actually wrong,
  // it just doesn't blank out perfectly good, already-rendered content to
  // do it.
  const [ready, setReady] = useState(false);
  // Passed down to EmployerSidebarShell so it can hide the gated sections
  // from the nav — the client-side courtesy half of the gate; see this
  // file's own doc comment on the real, server-side half.
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);

  useEffect(() => {
    if (pathname === '/employer') {
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace('/employer');
      return;
    }
    if (DEACTIVATED_EXEMPT_PATHS.includes(pathname)) {
      setReady(true);
      return;
    }

    let cancelled = false;
    api<{ organization: OrgMeOrganization }>('/orgs/me')
      .then(({ organization }) => {
        if (cancelled) return;
        setVerificationStatus(organization.verificationStatus);
        if (organization.deactivatedAt) {
          router.replace('/employer/deactivated');
          return;
        }
        if (SETUP_EXEMPT_PATHS.includes(pathname)) {
          setReady(true);
          return;
        }
        if (!isOrgSetupComplete(organization)) {
          router.replace('/employer/setup');
          return;
        }
        if (organization.verificationStatus !== 'VERIFIED') {
          router.replace('/employer/settings');
          return;
        }
        setReady(true);
      })
      // Best-effort — this is UX convenience, not the real gate (see this
      // file's own doc comment). A failed check here must never itself
      // lock an employer out; the page's own API calls still enforce it
      // server-side regardless.
      .catch(() => setReady(true));

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (pathname === '/employer') return <>{children}</>;
  if (!ready) return null;
  // /employer/deactivated is a standalone locked-state screen (its own
  // logout button, no self-service action beyond that) — same reasoning as
  // the bare /employer render above, just reached after the auth/ready gate
  // instead of before it, since (unlike the login route) this one still
  // requires a token: the card shows the org's name, which must stay behind
  // auth. DEACTIVATED_EXEMPT_PATHS is the same constant the effect above
  // already uses to skip the redirect-loop check for this path; reusing it
  // here too keeps "which paths are exempt from deactivation handling" in
  // one place instead of two lists that could drift apart.
  if (DEACTIVATED_EXEMPT_PATHS.includes(pathname)) return <>{children}</>;

  return (
    <EmployerSidebarShell verified={verificationStatus === 'VERIFIED'} onLoggedOut={() => router.replace('/employer')}>
      {children}
    </EmployerSidebarShell>
  );
}
