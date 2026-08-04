'use client';

/**
 * Settings stub. There is no employer-settings backend today — no update
 * endpoint on OrgsController, no editable fields on Organization beyond
 * name (see schema.prisma). Rather than omit the sidebar item (which would
 * make "how do I manage my org" a dead end) or link it somewhere
 * misleading, this shows what's real (org name, your role) and says
 * plainly that there's nothing to configure yet.
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

interface OrgMe {
  organization: { id: string; name: string };
  role: string;
}

export default function EmployerSettings() {
  const [org, setOrg] = useState<OrgMe>();
  const [error, setError] = useState('');

  useEffect(() => {
    api<OrgMe>('/orgs/me').then(setOrg).catch((e) => setError(e.message));
  }, []);

  return (
    <main className="container-standard">
      <h1>Settings</h1>

      {error && <p className="error">{error}</p>}
      {!error && !org && <p className="meta">Loading…</p>}

      {org && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div>
            <div className="meta" style={{ margin: 0 }}>Organization</div>
            <strong>{org.organization.name}</strong>
          </div>
          <div>
            <div className="meta" style={{ margin: 0 }}>Your role</div>
            <strong>{org.role === 'EMPLOYER_ADMIN' ? 'Admin' : 'Member'}</strong>
          </div>
          <p className="meta" style={{ marginTop: 12 }}>
            Nothing to configure yet — organization details, billing, and team management aren&apos;t available yet.
          </p>
        </div>
      )}
    </main>
  );
}
