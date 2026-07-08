'use client';

/** Employer home: greets by org name, placeholder sections for what's coming next. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import EmployerNav from './EmployerNav';
import EmployerJobs from './EmployerJobs';
import CandidateSearch from './CandidateSearch';

const { api } = employerApi;

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

  if (error) {
    return (
      <>
        <EmployerNav onLoggedOut={onLoggedOut} />
        <main>
          <p className="error">{error}</p>
          <p>
            Looking for the candidate app? <Link href="/">Go there instead</Link>.
          </p>
        </main>
      </>
    );
  }
  if (!org) {
    return (
      <>
        <EmployerNav onLoggedOut={onLoggedOut} />
        <main><p>Loading your organization…</p></main>
      </>
    );
  }

  return (
    <>
      <EmployerNav onLoggedOut={onLoggedOut} />
      <main>
        <h1>Welcome, {org.organization.name}</h1>
        <p>Signed in as {org.role === 'EMPLOYER_ADMIN' ? 'an admin' : 'a member'} of this organization.</p>

        <EmployerJobs />

        <CandidateSearch />

        <p className="app-footer-credit">by flair future Intelligence</p>
      </main>
    </>
  );
}
