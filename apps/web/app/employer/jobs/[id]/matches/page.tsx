'use client';

/** Job-to-Talent Match — sidebar-less, reached from job creation and from each job's row in Job Postings. Auth guard/shell come from app/employer/layout.tsx. */
import { useParams } from 'next/navigation';
import EmployerJobMatches from '@/components/EmployerJobMatches';

export default function EmployerJobMatchesPage() {
  const params = useParams<{ id: string }>();
  return (
    <main className="employer-content-narrow">
      <EmployerJobMatches jobId={params.id} />
    </main>
  );
}
