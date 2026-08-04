'use client';

/** Find Candidates — sidebar section. Auth guard/shell come from app/employer/layout.tsx. */
import CandidateSearch from '@/components/CandidateSearch';

export default function EmployerCandidatesPage() {
  return (
    <main className="container-standard">
      <h1>Find Candidates</h1>
      <CandidateSearch />
    </main>
  );
}
