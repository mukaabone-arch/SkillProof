'use client';

/**
 * Assessment-taking flow:
 * start attempt → fetch questions → answer (saved per-question, idempotent)
 * → submit → grade → result + badge.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

type IntegrityEventType =
  | 'TAB_BLUR'
  | 'TAB_FOCUS'
  | 'PASTE_ATTEMPT'
  | 'COPY_ATTEMPT'
  | 'FULLSCREEN_EXIT'
  | 'RIGHT_CLICK';

interface Question {
  id: string;
  type: string;
  body: { text: string; options: string[] };
}
interface Result {
  status: string;
  scorePercent: number | null;
  passed: boolean | null;
  assessmentTitle: string;
  skillName: string;
  badge: { verifyHash: string; level: string; expiresAt: string } | null;
}

export default function TakeAssessmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [attemptId, setAttemptId] = useState<string>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showIntegrityNotice, setShowIntegrityNotice] = useState(true);

  // Ref (not state) so in-flight event listeners always see the latest
  // value without needing to be torn down/rebuilt on every render.
  const finishedRef = useRef(false);

  const start = useCallback(async () => {
    if (!getToken()) { router.push('/'); return; }
    try {
      const attempt = await api<{ id: string }>(`/assessments/${id}/attempts`, { method: 'POST' });
      setAttemptId(attempt.id);
      setQuestions(await api<Question[]>(`/attempts/${attempt.id}/questions`));
    } catch (e) { setError((e as Error).message); }
    finally { setLoaded(true); }
  }, [id, router]);

  useEffect(() => { start(); }, [start]);

  /**
   * Best-effort, fire-and-forget: a failed report must never interrupt the
   * candidate mid-test. Counting/thresholding happens entirely server-side
   * (see AssessmentsService.addIntegrityEvent) — this call only surfaces
   * what was observed in the browser.
   */
  const reportIntegrityEvent = useCallback(
    (type: IntegrityEventType, metadata?: Record<string, unknown>) => {
      if (!attemptId || finishedRef.current) return;
      api(`/attempts/${attemptId}/integrity-event`, {
        method: 'POST',
        body: JSON.stringify({ type, metadata }),
      }).catch(() => undefined);
    },
    [attemptId],
  );

  // Tab/window blur + fullscreen-exit detection. Silent — a single blur is
  // never punished or interrupted (people get notifications); it's just recorded.
  useEffect(() => {
    if (!attemptId) return;

    let away = false;
    const handleBlur = () => {
      if (away) return;
      away = true;
      reportIntegrityEvent('TAB_BLUR');
    };
    const handleFocus = () => {
      if (!away) return;
      away = false;
      reportIntegrityEvent('TAB_FOCUS');
    };
    const handleVisibility = () => (document.hidden ? handleBlur() : handleFocus());
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) reportIntegrityEvent('FULLSCREEN_EXIT');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // Optional and best-effort — browsers may silently refuse this without a
    // direct user gesture; that's fine, we just won't see FULLSCREEN_EXIT then.
    document.documentElement.requestFullscreen?.().catch(() => undefined);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [attemptId, reportIntegrityEvent]);

  async function selectAnswer(questionId: string, optionIndex: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
    try {
      // Saved server-side immediately; safe to change (idempotent upsert)
      await api(`/attempts/${attemptId}/answers`, {
        method: 'POST',
        body: JSON.stringify({ questionId, answer: optionIndex }),
      });
    } catch (e) { setError((e as Error).message); }
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      await api(`/attempts/${attemptId}/submit`, { method: 'POST' });
      finishedRef.current = true; // stop reporting integrity events — the attempt is done
      setResult(await api<Result>(`/attempts/${attemptId}/result`));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (result) {
    return (
      <main>
        <h1>{result.passed ? '🎉 Passed!' : 'Not this time'}</h1>
        <p>
          {result.assessmentTitle} — score: <strong>{result.scorePercent}%</strong>
        </p>
        {result.passed && result.badge ? (
          <div className="card badge-card">
            <div>
              <strong>✓ Verified: {result.skillName} ({result.badge.level})</strong>
              <div className="meta">
                Valid until {new Date(result.badge.expiresAt).toLocaleDateString()}
              </div>
            </div>
            <Link href={`/badges/${result.badge.verifyHash}`}>
              <button>View certificate</button>
            </Link>
          </div>
        ) : (
          <p>Review the material and try again — your best attempt counts.</p>
        )}
        <Link href="/assessments">← Back to assessments</Link>
      </main>
    );
  }

  const answered = Object.keys(answers).length;

  return (
    <main>
      <h1>Assessment</h1>
      {error && <p className="error">{error}</p>}
      {loaded && !error && questions.length === 0 && (
        <p>This assessment has no questions yet — check back soon.</p>
      )}

      {showIntegrityNotice && questions.length > 0 && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <p style={{ margin: 0 }}>
            This assessment monitors basic integrity signals (tab switches, copy/paste, etc.) as part
            of verification. Answer normally — a brief distraction won&apos;t penalize you.
          </p>
          <button onClick={() => setShowIntegrityNotice(false)} style={{ alignSelf: 'flex-start' }}>
            Got it
          </button>
        </div>
      )}

      <div
        onPaste={(e) => {
          e.preventDefault();
          reportIntegrityEvent('PASTE_ATTEMPT');
        }}
        onCopy={() => reportIntegrityEvent('COPY_ATTEMPT')}
        onContextMenu={() => reportIntegrityEvent('RIGHT_CLICK')}
      >
        {questions.map((q, i) => (
          <div key={q.id} className="question">
            <p><strong>Q{i + 1}.</strong> {q.body.text}</p>
            {q.body.options.map((opt, idx) => (
              <label key={idx} className="option">
                <input
                  type="radio"
                  name={q.id}
                  checked={answers[q.id] === idx}
                  onChange={() => selectAnswer(q.id, idx)}
                />{' '}
                {opt}
              </label>
            ))}
          </div>
        ))}
      </div>
      {questions.length > 0 && (
        <button onClick={submit} disabled={busy || answered < questions.length}>
          {busy ? 'Grading…' : `Submit (${answered}/${questions.length} answered)`}
        </button>
      )}
    </main>
  );
}
