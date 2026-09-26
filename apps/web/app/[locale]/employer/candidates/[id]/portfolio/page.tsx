'use client';

/** Employer view of one candidate's portfolio. Auth/org guard/shell come from app/employer/layout.tsx. */
import { useParams } from 'next/navigation';
import EmployerPortfolioView from '@/components/EmployerPortfolioView';

export default function EmployerCandidatePortfolioPage() {
  const params = useParams<{ id: string }>();
  return (
    <main className="hub">
      <h1>Candidate portfolio</h1>
      <EmployerPortfolioView candidateId={params.id} />
    </main>
  );
}
