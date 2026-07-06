'use client';

/** Employer home: greets by org name, placeholder sections for what's coming next. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, logout } from '@/lib/api';

interface OrgMe {
  organization: { id: string; name: string };
  role: string;
}

interface Props {
  onLoggedOut: () => void;
}

export default function EmployerHome({ onLoggedOut }: Props) {
  const [org, setOrg] = useState<OrgMe>();
  const [error, setError] = useState('');

  useEffect(() => {
    api<OrgMe>('/orgs/me')
      .then(setOrg)
      .catch((e) => setError(e.message));
  }, []);

  async function handleLogout() {
    await logout();
    onLoggedOut();
  }

  if (error) {
    return (
      <main>
        <p className="error">{error}</p>
        <p>
          Looking for the candidate app? <Link href="/">Go there instead</Link>.
        </p>
      </main>
    );
  }
  if (!org) return <main><p>Loading your organization…</p></main>;

  return (
    <main>
      <nav className="row" style={{ justifyContent: 'space-between', margin: 0, marginBottom: 32 }}>
        <span className="meta" style={{ margin: 0 }}>Employer portal</span>
        <button onClick={handleLogout}>Log out</button>
      </nav>

      <h1>Welcome, {org.organization.name}</h1>
      <p>Signed in as {org.role === 'EMPLOYER_ADMIN' ? 'an admin' : 'a member'} of this organization.</p>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <strong>Post a job</strong>
        <span className="meta">Coming soon — publish roles and attach verified-skill requirements.</span>
      </div>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <strong>Find candidates</strong>
        <span className="meta">Coming soon — search candidates by verified skill badges.</span>
      </div>
    </main>
  );
}
