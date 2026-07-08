'use client';

/** Candidate job area: matched-to-you ranking, browse/search, and my applications. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/api';
import CandidateJobs from '@/components/CandidateJobs';

export default function JobsPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLoggedIn(!!getToken());
    setReady(true);
  }, []);

  return (
    <main>
      <h1>Jobs</h1>
      <p>Browse live openings, see how you match up, and track your applications.</p>

      {ready && !loggedIn && (
        <p className="error">
          You are not logged in — <Link href="/">log in first</Link> to view jobs.
        </p>
      )}

      {loggedIn && <CandidateJobs />}
    </main>
  );
}
