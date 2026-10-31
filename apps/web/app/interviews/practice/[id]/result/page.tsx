'use client';

/**
 * Mock interview feedback — GET /interview-sessions/:id/result. AI-written
 * coaching notes on each answer (summary, strengths, improvements, and the
 * STAR element that was missing, if any), plus the transcript. Practice
 * only: never shown to employers, never touches badges or matching.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import CandidateNav from '@/components/CandidateNav';
import { ErrorState, LoadingState } from '@/components/ui';

interface Result {
  sessionId: string;
  completedAt: string | null;
  answers: {
    questionId: string | null;
    questionText: string | null;
    category: string | null;
    missingStarElement: string | null;
    summary: string;
    strengths: string[];
    improvements: string[];
  }[];
  transcript: { id: string; role: string; content: string; superseded: boolean }[];
}

const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function PracticeResultPage() {
  const ready = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready) return;
    api<Result>(`/interview-sessions/${id}/result`).then(setResult).catch((e) => setError((e as Error).message));
  }, [ready, id]);

  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main className="container-standard">
        <p><Link href="/interviews">← Interviews</Link></p>
        <h1>Practice feedback</h1>
        <p className="meta">
          AI-written coaching on each answer. Practice only — never shown to employers, and it doesn&apos;t affect your
          verified badges or matches.
        </p>
        {error && <ErrorState message={error} />}
        {!result && !error && <LoadingState />}

        {result?.answers.map((a, i) => (
          <section key={a.questionId ?? i} className="ui-card mock-answer">
            {a.category && <span className="eyebrow">{titleCase(a.category)}</span>}
            {a.questionText && <h2>{a.questionText}</h2>}
            <p>{a.summary}</p>
            {a.strengths.length > 0 && (
              <>
                <h3>What worked</h3>
                <ul>{a.strengths.map((s, k) => <li key={k}>{s}</li>)}</ul>
              </>
            )}
            {a.improvements.length > 0 && (
              <>
                <h3>To make it stronger</h3>
                <ul>{a.improvements.map((s, k) => <li key={k}>{s}</li>)}</ul>
              </>
            )}
            {a.missingStarElement && (
              <p className="mock-star">Missing from your answer: <strong>{titleCase(a.missingStarElement)}</strong></p>
            )}
          </section>
        ))}

        {result && (
          <details className="ui-card mock-transcript">
            <summary>Full transcript</summary>
            {result.transcript.map((t) => (
              <p key={t.id} className={t.superseded ? 'mock-superseded' : undefined}>
                <strong>{t.role === 'CANDIDATE' ? 'You' : 'Interviewer'}:</strong> {t.content}
              </p>
            ))}
          </details>
        )}
      </main>
    </>
  );
}
