'use client';

/** Assessment catalog: lists live assessments from GET /assessments */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { isSafeReturnTo } from '@/lib/returnTo';
import { useRequireAuth } from '@/lib/useRequireAuth';

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

  const ready = useRequireAuth();
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [error, setError] = useState('');
  // Light, non-blocking nudge only — an empty profile never blocks taking
  // an assessment, it's just surfaced as a tip below.
  const [profileEmpty, setProfileEmpty] = useState(false);

  useEffect(() => {
    if (!ready) return;
    api<AssessmentItem[]>('/assessments')
      .then((items) => setItems(items.filter((a) => a._count.questions > 0)))
      .catch((e) => setError(e.message));
    api<{ completeness: number }>('/profiles/me')
      .then((p) => setProfileEmpty(p.completeness === 0))
      .catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main>
        <h1>Assessments</h1>
        <p>Pass an assessment to earn a verified skill badge.</p>
        {error && <p className="error">{error}</p>}
        {items.length === 0 && !error && (
          <p>
            No assessments are available just yet — check back soon. In the
            meantime, you can{' '}
            <Link href="/profile">add a verified credential</Link> on your
            profile to start applying.
          </p>
        )}
        {profileEmpty && items.length > 0 && (
          <p className="meta" style={{ marginTop: -8, marginBottom: 20 }}>
            Tip: completing your profile helps employers find you once you&apos;ve earned a badge —{' '}
            <Link href="/profile">complete your profile →</Link>
          </p>
        )}
        {isSafeReturnTo(returnTo) && items.length > 0 && (
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
