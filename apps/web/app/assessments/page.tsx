'use client';

/** Assessment catalog: lists live assessments from GET /assessments */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

interface MineSession {
  id: string;
  status: string;
  insufficientProbing: boolean;
  retakeAvailableAt: string | null;
}

/**
 * Below "View result" for a REJECTED session — cooldown-gated unless the
 * decision was INSUFFICIENT_PROBING (immediate, free retake; that's on the
 * assessor, not the candidate). The disabled state here is UX only: the
 * real rule is enforced server-side in POST /assessment-sessions (409 if
 * still inside the window), in case of a stale page or clock skew.
 */
function RetakeAction({ mine }: { mine: MineSession }) {
  const router = useRouter();
  const [retaking, setRetaking] = useState(false);
  const [error, setError] = useState('');

  const cooldownActive = !mine.insufficientProbing && !!mine.retakeAvailableAt && new Date(mine.retakeAvailableAt).getTime() > Date.now();

  async function retake() {
    setRetaking(true);
    setError('');
    try {
      const created = await api<{ session: { id: string } }>('/assessment-sessions', { method: 'POST' });
      router.push(`/assessments/discussion/session/${created.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setRetaking(false);
    }
  }

  if (cooldownActive) {
    return <span className="meta">Retake available from {new Date(mine.retakeAvailableAt!).toLocaleDateString()}</span>;
  }

  return (
    <div>
      <button onClick={retake} disabled={retaking}>
        {retaking
          ? 'Starting…'
          : mine.insufficientProbing
            ? "This session didn't give you a fair shot — retake now"
            : 'Retake assessment'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Primary action for the conversational-assessment card, driven entirely by
 * GET /assessment-sessions/mine — never a client-side guess. IN_PROGRESS/
 * EXPIRED must never offer a fresh start (resume-not-restart); while
 * anything is between AWAITING_SCORING and a decision, this page shows only
 * "In review" per spec — no button, no link, nothing more.
 */
function DiscussionAction({ mine }: { mine: MineSession | null | undefined }) {
  if (mine === undefined) return null;
  if (mine && (mine.status === 'IN_PROGRESS' || mine.status === 'EXPIRED')) {
    return (
      <Link href="/assessments/discussion/rag-systems-l2">
        <button>Resume your session</button>
      </Link>
    );
  }
  if (mine && (mine.status === 'AWAITING_SCORING' || mine.status === 'AWAITING_REVIEW' || mine.status === 'DISPUTED')) {
    return <span className="meta">In review</span>;
  }
  if (mine && (mine.status === 'ISSUED' || mine.status === 'REJECTED')) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        <Link href={`/assessments/discussion/session/${mine.id}/result`}>
          <button>View result</button>
        </Link>
        {mine.status === 'REJECTED' && <RetakeAction mine={mine} />}
      </div>
    );
  }
  return (
    <Link href="/assessments/discussion/rag-systems-l2">
      <button>Start</button>
    </Link>
  );
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
  const [mine, setMine] = useState<MineSession | null | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    api<AssessmentItem[]>('/assessments')
      .then((items) => setItems(items.filter((a) => a._count.questions > 0)))
      .catch((e) => setError(e.message));
    api<{ completeness: number }>('/profiles/me')
      .then((p) => setProfileEmpty(p.completeness === 0))
      .catch(() => undefined);
    api<MineSession | null>('/assessment-sessions/mine')
      .then(setMine)
      .catch(() => setMine(null));
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

        <div className="card discussion-entry-card">
          <div>
            <span className="eyebrow">Assessed by technical discussion</span>
            <div style={{ marginTop: 6 }}>
              <strong>RAG Systems</strong> · Level L2
              <div className="meta">A written conversation with an interviewer — around 20 minutes.</div>
            </div>
          </div>
          <DiscussionAction mine={mine} />
        </div>

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
