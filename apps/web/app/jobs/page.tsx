'use client';

/** Candidate job area: matched-to-you ranking, browse/search, and my applications. */
import { Suspense } from 'react';
import CandidateNav from '@/components/CandidateNav';
import CandidateJobs from '@/components/CandidateJobs';
import { useRequireAuth } from '@/lib/useRequireAuth';

export default function JobsPage() {
  const ready = useRequireAuth();
  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main>
        <h1>Jobs</h1>
        <p>Browse live openings, see how you match up, and track your applications.</p>

        <Suspense fallback={<p className="meta">Loading…</p>}>
          <CandidateJobs />
        </Suspense>
      </main>
    </>
  );
}
