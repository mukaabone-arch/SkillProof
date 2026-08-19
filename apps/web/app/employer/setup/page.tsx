'use client';

/**
 * Mandatory organisation-setup gate. Reached one of two ways: EmployerLayout
 * redirects here on every other /employer/* route once it sees the org is
 * incomplete (best-effort UX only — the real enforcement is
 * OrgSetupCompleteGuard on the API side, see org-readiness.ts), or an
 * employer navigates here directly. Exactly the three mandatory fields —
 * logo, industry, website — no "Invite your team" here; that stays an
 * optional nudge on the dashboard (EmployerDashboard.tsx), never part of
 * this gate. No Dismiss button: unlike the old checklist card, there's
 * nothing to dismiss — the whole reason this screen exists is that these
 * three aren't optional.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

interface OrgMe {
  organization: { industry: string | null; website: string | null; hasLogo: boolean };
}

type SetupField = 'logo' | 'industry' | 'website';

const SETUP_ITEMS: { key: SetupField; label: string }[] = [
  { key: 'logo', label: 'Add your company logo' },
  { key: 'industry', label: 'Add your industry' },
  { key: 'website', label: 'Add your website' },
];

export default function EmployerSetupPage() {
  const router = useRouter();
  const [organization, setOrganization] = useState<OrgMe['organization']>();
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setError('');
    try {
      const data = await api<OrgMe>('/orgs/me');
      setOrganization(data.organization);
      // Complete already (e.g. finished in another tab, or reached this
      // page directly out of habit) — no reason to sit here.
      if (data.organization.hasLogo && data.organization.industry && data.organization.website) {
        router.replace('/employer/dashboard');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const done: Record<SetupField, boolean> = organization
    ? { logo: organization.hasLogo, industry: !!organization.industry, website: !!organization.website }
    : { logo: false, industry: false, website: false };
  const doneCount = Object.values(done).filter(Boolean).length;

  return (
    <main className="container-standard">
      <h1>Set up your organisation</h1>
      <p>Complete these three before you can use the rest of the employer portal.</p>

      {error && <p className="error">{error}</p>}
      {!organization && !error && <p className="meta">Loading…</p>}

      {organization && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <h2 style={{ margin: 0 }}>Organisation profile</h2>
            <span className="meta" style={{ margin: 0 }}>{doneCount} of {SETUP_ITEMS.length} done</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SETUP_ITEMS.map((item) =>
              done[item.key] ? (
                <div key={item.key} className="row" style={{ margin: 0, gap: 8, alignItems: 'center' }}>
                  <span aria-hidden="true" className="ok">✓</span>
                  <span>{item.label}</span>
                </div>
              ) : (
                <Link
                  key={item.key}
                  href="/employer/settings#organisation"
                  className="row"
                  style={{ margin: 0, gap: 8, alignItems: 'center' }}
                >
                  <span aria-hidden="true" style={{ color: 'var(--ink-60)' }}>○</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              ),
            )}
          </div>
        </div>
      )}
    </main>
  );
}
