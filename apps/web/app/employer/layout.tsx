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
 * Also gates on organisation-setup completeness (logo/industry/website) —
 * UX convenience only, mirroring but not replacing OrgSetupCompleteGuard's
 * real, server-side enforcement (see apps/api's org-readiness.ts). Every
 * employer-portal page depends on this same check, so it belongs here
 * rather than duplicated per-page, same reasoning as the auth check above.
 * SETUP_EXEMPT_PATHS must stay in sync with which controllers
 * OrgSetupCompleteGuard is (and isn't) attached to on the API side: the
 * setup screen itself (nowhere else to send an incomplete org) and
 * settings (the org-info/logo edit form and team management both live
 * there — OrgsController and OrgMembersController are both ungated).
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

interface OrgMeOrganization extends OrgReadinessFields {
  deactivatedAt: string | null;
}

export default function EmployerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);

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
    <EmployerSidebarShell onLoggedOut={() => router.replace('/employer')}>
      {children}
    </EmployerSidebarShell>
  );
}
