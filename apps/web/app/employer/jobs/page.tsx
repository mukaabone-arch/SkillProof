'use client';

/** Job Postings — sidebar section. Auth guard/shell come from app/employer/layout.tsx. */
import { Suspense } from 'react';
import EmployerJobs from '@/components/EmployerJobs';

export default function EmployerJobsPage() {
  return (
    <main className="container-wide">
      <h1>Job Postings</h1>
      <Suspense fallback={<p className="meta">Loading…</p>}>
        <EmployerJobs />
      </Suspense>
    </main>
  );
}
