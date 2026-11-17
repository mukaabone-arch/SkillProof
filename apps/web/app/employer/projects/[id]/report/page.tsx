'use client';

/** Project report (/employer/projects/[id]/report). Auth guard/shell come from app/employer/layout.tsx. */
import { useParams } from 'next/navigation';
import EmployerProjectReport from '@/components/EmployerProjectReport';

export default function EmployerProjectReportPage() {
  const params = useParams<{ id: string }>();
  return (
    <main className="container-wide project-report-main">
      <EmployerProjectReport projectId={params.id} />
    </main>
  );
}
