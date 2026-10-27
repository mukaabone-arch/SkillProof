'use client';

/**
 * Admin queue for in-app reports of AI-generated content (Google Play
 * AI-Generated Content policy). Each row shows what the candidate reported
 * (a snapshot taken at report time), why, and a link to the session's review
 * case. "Mark reviewed" closes it with an optional resolution note.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Report {
  id: string;
  sessionId: string;
  targetType: 'ASSESSOR_TURN' | 'LIVE_FEEDBACK' | 'RESULT_REASON';
  targetId: string;
  reason: string;
  note: string | null;
  contentSnapshot: string;
  status: 'OPEN' | 'REVIEWED';
  createdAt: string;
  reviewedAt: string | null;
  resolutionNote: string | null;
}

const TARGET_LABEL: Record<Report['targetType'], string> = {
  ASSESSOR_TURN: 'AI interviewer message',
  LIVE_FEEDBACK: 'Live reviewer notes',
  RESULT_REASON: 'Result reason',
};

const REASON_LABEL: Record<string, string> = {
  OFFENSIVE: 'Offensive or harmful',
  HATEFUL: 'Hateful or discriminatory',
  SEXUAL: 'Sexual or inappropriate',
  DANGEROUS: 'Dangerous or illegal',
  MISLEADING: 'Misleading or wrong',
  OTHER: 'Something else',
};

/** LIVE_FEEDBACK snapshots are JSON — show them readably. */
function prettySnapshot(r: Report): string {
  if (r.targetType !== 'LIVE_FEEDBACK') return r.contentSnapshot;
  try {
    return JSON.stringify(JSON.parse(r.contentSnapshot), null, 2);
  } catch {
    return r.contentSnapshot;
  }
}

export default function AdminAiReportsPage() {
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const [rows, setRows] = useState<Report[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await api<Report[]>(`/admin/ai-content-reports${filter === 'OPEN' ? '?status=OPEN' : ''}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function markReviewed(id: string) {
    const note = window.prompt('Resolution note (optional) — what did you find / do?');
    if (note === null) return; // cancelled
    setBusy(id);
    try {
      await api(`/admin/ai-content-reports/${id}/review`, {
        method: 'POST',
        body: JSON.stringify(note.trim() ? { resolutionNote: note.trim() } : {}),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <h1>AI content reports</h1>
      <p className="meta">
        Candidates&apos; reports of offensive or inappropriate AI responses. Review each one and mark it reviewed.
      </p>

      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <button type="button" onClick={() => setFilter('OPEN')} aria-pressed={filter === 'OPEN'} disabled={filter === 'OPEN'}>
          Open
        </button>
        <button type="button" onClick={() => setFilter('ALL')} aria-pressed={filter === 'ALL'} disabled={filter === 'ALL'}>
          All
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p>Loading…</p>}
      {rows && rows.length === 0 && <p className="meta">{filter === 'OPEN' ? 'No open reports.' : 'No reports yet.'}</p>}

      {rows?.map((r) => (
        <div key={r.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0, flexWrap: 'wrap', gap: 8 }}>
            <strong>
              {REASON_LABEL[r.reason] ?? r.reason} · {TARGET_LABEL[r.targetType]}
            </strong>
            <span className="meta">
              {new Date(r.createdAt).toLocaleString()} · {r.status === 'OPEN' ? 'Open' : 'Reviewed'}
            </span>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.85rem' }}>{prettySnapshot(r)}</pre>
          {r.note && (
            <p style={{ margin: 0 }}>
              <em>Candidate note:</em> {r.note}
            </p>
          )}
          {r.resolutionNote && (
            <p className="meta" style={{ margin: 0 }}>
              Resolution: {r.resolutionNote}
            </p>
          )}
          <div className="row" style={{ gap: 8, margin: 0 }}>
            <Link href={`/admin/review/${r.sessionId}`}>Open session</Link>
            {r.status === 'OPEN' && (
              <button type="button" onClick={() => markReviewed(r.id)} disabled={busy === r.id}>
                {busy === r.id ? 'Saving…' : 'Mark reviewed'}
              </button>
            )}
          </div>
        </div>
      ))}
    </main>
  );
}
