'use client';

/** Opportunities: employers and recruiters who reached out through AI sourcing, and who may contact the candidate. */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CandidateNav from '@/components/CandidateNav';
import OutreachInbox from '@/components/OutreachInbox';
import OutreachPreferences from '@/components/OutreachPreferences';
import { useRequireAuth } from '@/lib/useRequireAuth';

function Inbox() {
  const focusId = useSearchParams().get('m');
  return <OutreachInbox showEmpty focusId={focusId} />;
}

export default function OpportunitiesPage() {
  const ready = useRequireAuth();
  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main className="container-standard">
        <h1>Opportunities</h1>
        <p>Roles employers brought to you because your verified skills match.</p>
        <div className="list-page-columns">
          <div className="list-page-main">
            <Suspense fallback={null}>
              <Inbox />
            </Suspense>
          </div>
          <div className="list-page-sidebar">
            <OutreachPreferences />
          </div>
        </div>
      </main>
    </>
  );
}
