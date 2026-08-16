'use client';

/**
 * PLATFORM_ADMIN case page for one flagged MCQ attempt — the timed-test
 * counterpart to /admin/review/[sessionId]. Sidebar/topbar come from
 * app/admin/layout.tsx.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

interface IntegrityEvent {
  type: string;
  metadata: unknown;
  createdAt: string;
}

interface AttemptCase {
  id: string;
  status: string;
  scorePercent: number | null;
  passed: boolean | null;
  startedAt: string | null;
  submittedAt: string | null;
  candidate: { id: string; fullName: string | null; phone: string | null; email: string | null };
  assessmentTitle: string;
  skillName: string;
  integrity: {
    status: 'CLEAN' | 'FLAGGED' | 'REVIEW' | 'INVALIDATED';
    flagCount: number;
    eventCountsByType: Record<string, number>;
    events: IntegrityEvent[];
  };
}

function candidateLabel(c: AttemptCase['candidate']): string {
  return c.fullName ?? c.email ?? c.phone ?? c.id.slice(0, 8);
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export default function AdminAttemptCasePage() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [data, setData] = useState<AttemptCase | null>(null);
  const [error, setError] = useState('');

  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<'APPROVED' | 'INVALIDATED' | null>(null);

  const load = useCallback(() => {
    api<AttemptCase>(`/admin/attempts/${id}`)
      .then((d) => {
        setData(d);
        setStatus('ok');
      })
      .catch(() => setStatus('forbidden'));
  }, [id]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, [load]);

  async function submitDecision(outcome: 'APPROVED' | 'INVALIDATED') {
    setError('');
    setSubmitting(outcome);
    try {
      await api(`/admin/attempts/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ outcome, note: note.trim() || undefined }),
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Attempt Review</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden' || !data) {
    return (
      <main className="hub">
        <h1>Attempt Review</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to review flagged attempts.</p>
      </main>
    );
  }

  return (
    <main className="hub">
      <p>
        <Link href="/admin/attempts">← Back to queue</Link>
      </p>
      <h1>{candidateLabel(data.candidate)}</h1>
      <p className="hub-subhead">
        {data.skillName} · {data.assessmentTitle} · started {fmtDate(data.startedAt)} · submitted{' '}
        {fmtDate(data.submittedAt)}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginBottom: 24 }}>
        <div className="row" style={{ margin: 0, justifyContent: 'space-between' }}>
          <strong>Result</strong>
          <Badge variant={data.integrity.status === 'INVALIDATED' ? 'danger' : data.integrity.status === 'CLEAN' ? 'verified' : 'warning'}>
            {data.integrity.status}
          </Badge>
        </div>
        <div className="meta">
          Status: {data.status}
          {data.scorePercent !== null && ` · Score: ${data.scorePercent}%`}
          {data.passed !== null && (data.passed ? ' · Passed' : ' · Failed')}
        </div>
        <div className="meta">Candidate: {candidateLabel(data.candidate)}</div>
      </div>

      <h2 style={{ marginBottom: 12 }}>
        Integrity signals ({data.integrity.flagCount} flag{data.integrity.flagCount === 1 ? '' : 's'})
      </h2>

      {Object.keys(data.integrity.eventCountsByType).length === 0 ? (
        <EmptyState message="No integrity events recorded for this attempt." />
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
          {Object.entries(data.integrity.eventCountsByType).map(([type, count]) => (
            <span key={type} className="chip">
              {type.replace(/_/g, ' ').toLowerCase()} × {count}
            </span>
          ))}
        </div>
      )}

      {data.integrity.events.length > 0 && (
        <details style={{ marginBottom: 24 }}>
          <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Event timeline</summary>
          {data.integrity.events.map((e, i) => (
            <div key={i} className="meta" style={{ marginBottom: 4 }}>
              {fmtDate(e.createdAt)} — {e.type.replace(/_/g, ' ').toLowerCase()}
              {e.metadata != null && ` — ${JSON.stringify(e.metadata)}`}
            </div>
          ))}
        </details>
      )}

      <h2 style={{ marginBottom: 12 }}>Decision</h2>
      <div className="field" style={{ maxWidth: 480 }}>
        <label htmlFor="note">Note (optional)</label>
        <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
      <div className="row">
        <button onClick={() => submitDecision('APPROVED')} disabled={submitting !== null}>
          {submitting === 'APPROVED' ? 'Approving…' : 'Approve (clears flag)'}
        </button>
        <button className="btn-secondary" onClick={() => submitDecision('INVALIDATED')} disabled={submitting !== null}>
          {submitting === 'INVALIDATED' ? 'Invalidating…' : 'Invalidate (revokes badge)'}
        </button>
      </div>
    </main>
  );
}
