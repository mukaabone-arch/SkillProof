'use client';

/** Where a candidate tracks every active hiring pipeline — see CandidateInterviews. */
import CandidateNav from '@/components/CandidateNav';
import CandidateInterviews from '@/components/CandidateInterviews';
import { useRequireAuth } from '@/lib/useRequireAuth';

export default function InterviewsPage() {
  const ready = useRequireAuth();
  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main>
        <h1>Interviews</h1>
        <p>Track where you stand with every employer who&apos;s invited you to interview.</p>

        <CandidateInterviews />
      </main>
    </>
  );
}
