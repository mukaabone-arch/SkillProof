'use client';

/**
 * Assessment-taking flow:
 * start attempt → fetch questions → answer (saved per-question, idempotent)
 * → submit → grade → result + badge.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

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

  const start = useCallback(async () => {
    if (!getToken()) { router.push('/'); return; }
    try {
      const attempt = await api<{ id: string }>(`/assessments/${id}/attempts`, { method: 'POST' });
      setAttemptId(attempt.id);
      setQuestions(await api<Question[]>(`/attempts/${attempt.id}/questions`));
    } catch (e) { setError((e as Error).message); }
  }, [id, router]);

  useEffect(() => { start(); }, [start]);

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
      {questions.length > 0 && (
        <button onClick={submit} disabled={busy || answered < questions.length}>
          {busy ? 'Grading…' : `Submit (${answered}/${questions.length} answered)`}
        </button>
      )}
    </main>
  );
}
