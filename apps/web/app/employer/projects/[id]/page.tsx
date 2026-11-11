'use client';

/** One hiring project. Auth guard/shell come from app/employer/layout.tsx. */
import { useParams } from 'next/navigation';
import EmployerProjectDetail from '@/components/EmployerProjectDetail';

export default function EmployerProjectPage() {
  const params = useParams<{ id: string }>();
  return (
    <main className="employer-content-narrow">
      <EmployerProjectDetail projectId={params.id} />
    </main>
  );
}
