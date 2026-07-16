'use client';

/**
 * Pre-session setup for the conversational assessment. Only one skill/level
 * exists today (RAG Systems L2, slug "rag-systems-l2") so content here is
 * fixed rather than fetched — matches how the rest of this module treats
 * skill/level as a constant (see rag-systems-l2.rubric.ts on the API side).
 *
 * No CandidateNav — mirrors the MCQ assessment flow's own pre-test screen
 * (apps/web/app/assessments/[id]/page.tsx), which is chrome-free start to
 * finish. Same convention, same reason: one focused thing to do.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

interface MineSession {
  id: string;
  status: string;
}

const SKILL_NAME = 'RAG Systems';
const SKILL_LEVEL = 'L2';

export default function DiscussionSetupPage() {
  const router = useRouter();
  const [mine, setMine] = useState<MineSession | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<MineSession | null>('/assessment-sessions/mine')
      .then(setMine)
      .catch(() => setMine(null));
  }, [router]);

  async function start() {
    setStarting(true);
    setError('');
    try {
      // Idempotent server-side: if an IN_PROGRESS/EXPIRED session already
      // exists, this returns that same session rather than creating a new
      // one — so "Resume your session" below and "Start" both call this,
      // and neither can ever fork into a second, competing session.
      const created = await api<{ session: { id: string } }>('/assessment-sessions', { method: 'POST' });
      router.push(`/assessments/discussion/session/${created.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  const resumable = mine?.status === 'IN_PROGRESS' || mine?.status === 'EXPIRED';

  return (
    <main>
      <h1>{SKILL_NAME} · Level {SKILL_LEVEL}</h1>
      <p className="meta">A written technical discussion. Around 20 minutes.</p>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>You&apos;ll work through a design problem in conversation.</li>
          <li>Work on it alone — reasoning matters more than polish.</li>
          <li>The session is recorded and reviewed by a person before any badge is issued.</li>
          <li>You&apos;ll hear back within a day.</li>
        </ul>
      </div>

      {error && <p className="error">{error}</p>}

      {mine === undefined ? (
        <p>Loading…</p>
      ) : (
        <button onClick={start} disabled={starting}>
          {starting ? (resumable ? 'Resuming…' : 'Starting…') : resumable ? 'Resume your session' : 'Start'}
        </button>
      )}

      <p style={{ marginTop: 16 }}>
        <Link href="/assessments">← Back to assessments</Link>
      </p>
    </main>
  );
}
