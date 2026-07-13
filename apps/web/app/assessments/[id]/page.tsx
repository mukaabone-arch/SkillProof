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
  | 'RIGHT_CLICK'
  | 'PRINT_SCREEN';

interface Question {
  id: string;
  type: string;
  body: { text: string; options: string[] };
}
interface QuestionsResponse {
  questions: Question[];
  /** Server-computed remaining time — the server is authoritative; this only drives the display. */
  remainingSeconds: number | null;
  deadlineAt: string | null;
}
interface Result {
  status: string;
  scorePercent: number | null;
  passed: boolean | null;
  passThreshold: number;
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
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // Gates start(): the attempt is never created until the candidate has
  // explicitly acknowledged the monitoring notice below.
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);

  // Ref (not state) so in-flight event listeners always see the latest
  // value without needing to be torn down/rebuilt on every render.
  const finishedRef = useRef(false);

  const start = useCallback(async () => {
    if (!getToken()) { router.push('/'); return; }
    try {
      const attempt = await api<{ id: string }>(`/assessments/${id}/attempts`, { method: 'POST' });
      setAttemptId(attempt.id);
      const res = await api<QuestionsResponse>(`/attempts/${attempt.id}/questions`);
      setQuestions(res.questions);
      setRemainingSeconds(res.remainingSeconds);
    } catch (e) { setError((e as Error).message); }
    finally { setLoaded(true); }
  }, [id, router]);

  useEffect(() => {
    if (acknowledged) start();
  }, [acknowledged, start]);

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
    /**
     * Catches the PrintScreen key specifically (via keyup — PrintScreen
     * doesn't reliably fire keydown/keypress across browsers and can't be
     * preventDefault-ed). This is a partial signal only: OS-level capture
     * tools that don't involve that key — the Windows Snipping Tool
     * (Win+Shift+S), a phone photographing the screen, etc. — never touch
     * the browser and are not detectable here. Do not treat this as
     * screenshot prevention, only as one more review signal.
     */
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') reportIntegrityEvent('PRINT_SCREEN');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keyup', handleKeyUp);

    // Optional and best-effort — browsers may silently refuse this without a
    // direct user gesture; that's fine, we just won't see FULLSCREEN_EXIT then.
    document.documentElement.requestFullscreen?.().catch(() => undefined);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keyup', handleKeyUp);
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

  /**
   * There's no cooldown on this system — startAttempt() happily opens a new
   * attempt the moment the previous one is GRADED — so retrying just resets
   * local state back to the pre-attempt notice gate; re-acknowledging it is
   * required again for the new attempt, same as the first one.
   */
  function retry() {
    finishedRef.current = false;
    setResult(undefined);
    setQuestions([]);
    setAnswers({});
    setAttemptId(undefined);
    setRemainingSeconds(null);
    setLoaded(false);
    setError('');
    setAckChecked(false);
    setAcknowledged(false);
  }

  /**
   * Client-side countdown display only — the server is authoritative
   * (AssessmentsService.enforceDeadline runs on every getQuestions/
   * submitAnswer call regardless of this timer). At zero we still call
   * submit() so the UI moves on immediately instead of waiting for the
   * candidate to notice; if the server already auto-graded it in the
   * background, this just fetches that result.
   */
  useEffect(() => {
    if (remainingSeconds === null || result || finishedRef.current) return;
    if (remainingSeconds <= 0) {
      submit();
      return;
    }
    const timer = setTimeout(() => setRemainingSeconds((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSeconds, result]);

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  if (result) {
    return (
      <main>
        <h1>{result.passed ? '🎉 Passed!' : 'Not this time'}</h1>
        {/*
          Performance summary only — score, pass/fail against the threshold,
          and (once questions carry a topic tag — they don't yet, see
          AssessmentsService.getResult) a strong/weak breakdown by area.
          Never the questions themselves or which answers were right/wrong —
          that would leak the question bank to every candidate who takes it.
        */}
        <p>
          {result.assessmentTitle} — score: <strong>{result.scorePercent}%</strong>{' '}
          <span className="meta">(pass threshold: {result.passThreshold}%)</span>
        </p>
        {result.passed && result.badge ? (
          <>
            <div className="card badge-card">
              <div>
                <strong>✓ Verified: {result.skillName} ({result.badge.level})</strong>
                <div className="meta">
                  Valid until {new Date(result.badge.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <Link href={`/badges/${result.badge.verifyHash}`}>
                <button>View your verified certificate</button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p>Review the material and try again — your best attempt counts.</p>
            <p className="meta">
              No cooldown — you can retry this assessment right away, as many times as you like.
            </p>
            <div className="row" style={{ margin: 0 }}>
              <button onClick={retry}>Try again</button>
            </div>
          </>
        )}
        <Link href="/assessments">← Back to assessments</Link>
      </main>
    );
  }

  if (!acknowledged) {
    return (
      <main>
        <h1>Before you begin</h1>
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <p style={{ margin: 0 }}>This assessment is monitored for integrity. While it&apos;s in progress:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Stay in this browser tab and window — don&apos;t switch tabs or apps.</li>
            <li>Don&apos;t copy or paste.</li>
            <li>Don&apos;t exit fullscreen.</li>
            <li>Complete it in one sitting, within the time limit.</li>
          </ul>
          <p className="meta" style={{ margin: 0 }}>
            These are recorded as review signals, not automatic failures — an isolated distraction
            won&apos;t penalize you. Repeated or serious deviations are flagged for a human to review
            before any badge is issued.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={ackChecked}
              onChange={(e) => setAckChecked(e.target.checked)}
            />
            I understand and agree to these conditions.
          </label>
          <button
            onClick={() => setAcknowledged(true)}
            disabled={!ackChecked}
            style={{ alignSelf: 'flex-start' }}
          >
            I understand, begin
          </button>
        </div>
        <Link href="/assessments">← Back to assessments</Link>
      </main>
    );
  }

  const answered = Object.keys(answers).length;

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', margin: 0 }}>
        <h1 style={{ marginBottom: 0 }}>Assessment</h1>
        {remainingSeconds !== null && questions.length > 0 && (
          <span className={remainingSeconds <= 60 ? 'error' : 'meta'} style={{ margin: 0 }}>
            Time remaining: {formatTime(remainingSeconds)}
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {loaded && !error && questions.length === 0 && (
        <p>This assessment has no questions yet — check back soon.</p>
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
