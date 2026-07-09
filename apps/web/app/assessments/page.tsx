'use client';

/** Assessment catalog: lists live assessments from GET /assessments */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { isSafeReturnTo } from '@/lib/returnTo';

interface AssessmentItem {
  id: string;
  title: string;
  targetLevel: string;
  durationMins: number;
  passThreshold: number;
  isPremium: boolean;
  skill: { name: string; domain: { name: string } };
  _count: { questions: number };
}

function AssessmentsPageInner() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [error, setError] = useState('');
  // Resolved after mount so server and client render the same first pass
  // (prevents the hydration mismatch on the "not logged in" message).
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);
  // Light, non-blocking nudge only — assessments stay fully accessible with
  // or without a profile (free exploration is the design principle).
  const [profileEmpty, setProfileEmpty] = useState(false);

  useEffect(() => {
    const hasToken = !!getToken();
    setLoggedIn(hasToken);
    setReady(true);
    api<AssessmentItem[]>('/assessments')
      .then((items) => setItems(items.filter((a) => a._count.questions > 0)))
      .catch((e) => setError(e.message));
    if (hasToken) {
      api<{ completeness: number }>('/profiles/me')
        .then((p) => setProfileEmpty(p.completeness === 0))
        .catch(() => undefined);
    }
  }, []);

  return (
    <>
      {loggedIn && <CandidateNav onLoggedOut={() => setLoggedIn(false)} />}
      <main>
        <h1>Assessments</h1>
        <p>Pass an assessment to earn a verified skill badge.</p>
        {ready && !loggedIn && (
          <p className="error">
            You are not logged in — <Link href="/">log in first</Link> to start an attempt.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {ready && items.length === 0 && !error && (
          <p>No live assessments yet. Run the assessment seed.</p>
        )}
        {loggedIn && profileEmpty && items.length > 0 && (
          <p className="meta" style={{ marginTop: -8, marginBottom: 20 }}>
            Tip: completing your profile helps employers find you once you&apos;ve earned a badge —{' '}
            <Link href="/profile">complete your profile →</Link>
          </p>
        )}
        {loggedIn && isSafeReturnTo(returnTo) && items.length > 0 && (
          <p className="meta" style={{ marginTop: -8, marginBottom: 20 }}>
            Pass an assessment to earn a verified badge, then{' '}
            <Link href={returnTo}>return to the job you were applying to →</Link>
          </p>
        )}
        {items.map((a) => (
          <div key={a.id} className="card">
            <div>
              <strong>{a.title}</strong>
              <div className="meta">
                {a.skill.domain.name} → {a.skill.name} · Level {a.targetLevel} · {a.durationMins} min
                · pass ≥ {a.passThreshold}%
              </div>
            </div>
            <Link href={`/assessments/${a.id}`}>
              <button>Start</button>
            </Link>
          </div>
        ))}
      </main>
    </>
  );
}

export default function AssessmentsPage() {
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <AssessmentsPageInner />
    </Suspense>
  );
}
