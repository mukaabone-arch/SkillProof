'use client';

/** Job Postings → Import from file. Auth guard/shell come from app/employer/layout.tsx. */
import { Suspense } from 'react';
import EmployerJobImport from '@/components/EmployerJobImport';

export default function EmployerJobImportPage() {
  return (
    <main className="employer-content-narrow">
      <h1>Import jobs</h1>
      <Suspense fallback={<p className="meta">Loading…</p>}>
        <EmployerJobImport />
      </Suspense>
    </main>
  );
}
