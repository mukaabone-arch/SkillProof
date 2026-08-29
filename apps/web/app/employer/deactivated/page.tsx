'use client';

/**
 * Shown instead of the employer portal when the organization is
 * deactivated — see apps/api's OrgActiveGuard (embedded in OrgMemberGuard,
 * the real server-side enforcement) and EmployerLayout's own doc comment
 * on why this page is the one exempt path. Modeled directly on the
 * candidate app's /verify page: an explanation screen with its own logout
 * button, not relying on EmployerSidebarShell being present — there is no
 * self-service fix here (only a platform admin can reactivate), so unlike
 * /verify there's no action to offer beyond understanding why and signing
 * out.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { employerApi } from '@/lib/api';

const { api, logout } = employerApi;

interface OrgMe {
  organization: { name: string; deactivatedAt: string | null };
}

export default function EmployerDeactivatedPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    api<OrgMe>('/orgs/me')
      .then((data) => {
        // Already reactivated (e.g. by support while this tab sat open) —
        // no reason to keep showing this screen.
        if (!data.organization.deactivatedAt) {
          router.replace('/employer/dashboard');
          return;
        }
        setOrgName(data.organization.name);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [router]);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    router.replace('/employer');
  }

  return (
    <main className="auth auth-gradient">
      <h1 className="auth-headline">Organization deactivated</h1>
      <div className="auth-card">
        <h2 style={{ marginTop: 0 }}>
          {orgName ? <>{orgName} has been deactivated</> : 'This organization has been deactivated'}
        </h2>
        <p>
          Every team member — not just whoever deactivated it — has lost access to the employer portal. Any live
          jobs were unpublished and applicants were notified when this happened; those postings stay closed even
          after reactivation.
        </p>
        <p>
          There is no self-service way to undo this. Reactivation is only available through MyAmbii support.
        </p>

        {loadError && <p className="error">{loadError}</p>}

        <div className="row" style={{ margin: '20px 0 0' }}>
          <Link href="/contact">
            <button type="button">Contact support</button>
          </Link>
          <button type="button" className="btn-secondary" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      </div>
    </main>
  );
}
