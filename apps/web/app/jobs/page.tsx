'use client';

/** Candidate job area: matched-to-you ranking, browse/search, and my applications. */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import CandidateJobs from '@/components/CandidateJobs';

export default function JobsPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLoggedIn(!!getToken());
    setReady(true);
  }, []);

  return (
    <>
      {loggedIn && <CandidateNav onLoggedOut={() => setLoggedIn(false)} />}
      <main>
        <h1>Jobs</h1>
        <p>Browse live openings, see how you match up, and track your applications.</p>

        {ready && !loggedIn && (
          <p className="error">
            You are not logged in — <Link href="/">log in first</Link> to view jobs.
          </p>
        )}

        {loggedIn && (
          <Suspense fallback={<p className="meta">Loading…</p>}>
            <CandidateJobs />
          </Suspense>
        )}
      </main>
    </>
  );
}
