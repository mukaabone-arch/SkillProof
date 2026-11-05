'use client';

/**
 * PLATFORM_ADMIN integrity review queue for MCQ attempts — the timed-test
 * counterpart to /admin/review, which only covers discussion-format
 * sessions. Same weight: an INVALIDATED decision here revokes the
 * candidate's badge (see AdminService.reviewAttempt). Access is gated by
 * the backend (RolesGuard) — this page just probes GET /admin/attempts and
 * shows an "admins only" message if that call is rejected, same pattern as
 * every other page in this console. Sidebar/topbar come from
 * app/admin/layout.tsx.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

type IntegrityStatus = 'CLEAN' | 'FLAGGED' | 'REVIEW' | 'INVALIDATED';

interface AttemptRow {
  id: string;
  status: string;
  scorePercent: number | null;
  passed: boolean | null;
  candidate: { id: string; fullName: string | null; phone: string | null; email: string | null };
  assessmentTitle: string;
  skillName: string;
  integrityStatus: IntegrityStatus;
  integrityFlagCount: number;
  reviewOutcome: 'APPROVED' | 'INVALIDATED' | null;
  reviewedAt: string | null;
}

const STATUS_BADGE: Record<IntegrityStatus, 'default' | 'warning' | 'danger' | 'verified'> = {
  CLEAN: 'verified',
  FLAGGED: 'warning',
  REVIEW: 'warning',
  INVALIDATED: 'danger',
};

function candidateLabel(c: AttemptRow['candidate']): string {
  return c.fullName ?? c.email ?? c.phone ?? c.id.slice(0, 8);
}

export default function AdminAttemptsPage() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [filter, setFilter] = useState<IntegrityStatus | ''>('FLAGGED');
  const [error, setError] = useState('');

  const load = useCallback((f: IntegrityStatus | '') => {
    const qs = f ? `?status=${f}` : '';
    api<AttemptRow[]>(`/admin/attempts${qs}`)
      .then((r) => {
        setRows(r);
        setStatus('ok');
        setError('');
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'ok') load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Attempt Reviews</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Attempt Reviews</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to review flagged attempts.</p>
      </main>
    );
  }

  return (
    <main className="hub">
      <h1>Attempt Reviews</h1>
      <p className="hub-subhead">
        MCQ attempts flagged by the proctoring signals during the test. Approving clears the flag; invalidating
        revokes any badge already issued from this attempt.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="field" style={{ maxWidth: 240, marginBottom: 20 }}>
        <label htmlFor="statusFilter">Integrity status</label>
        <select id="statusFilter" value={filter} onChange={(e) => setFilter(e.target.value as IntegrityStatus | '')}>
          <option value="">All</option>
          <option value="FLAGGED">Flagged (needs a decision)</option>
          <option value="REVIEW">In review</option>
          <option value="CLEAN">Clean</option>
          <option value="INVALIDATED">Invalidated</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="Nothing matches this filter." />
      ) : (
        rows.map((row) => (
          <Link
            key={row.id}
            href={`/admin/attempts/${row.id}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className="card">
              <div className="assessment-row">
                <div className="assessment-info">
                  <strong>{candidateLabel(row.candidate)}</strong>{' '}
                  <span className="chip">
                    {row.skillName} · {row.assessmentTitle}
                  </span>
                  <Badge variant={STATUS_BADGE[row.integrityStatus]} style={{ marginLeft: 8 }}>
                    {row.integrityStatus} · {row.integrityFlagCount} flag{row.integrityFlagCount === 1 ? '' : 's'}
                  </Badge>
                  <div className="meta">
                    {row.status}
                    {row.scorePercent !== null && ` · ${row.scorePercent}%`}
                    {row.passed !== null && (row.passed ? ' · passed' : ' · failed')}
                    {row.reviewOutcome && ` · reviewed: ${row.reviewOutcome}`}
                  </div>
                </div>
              </div>
            </div>
          </Link>
        ))
      )}
    </main>
  );
}
