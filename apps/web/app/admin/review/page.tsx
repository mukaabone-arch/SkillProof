'use client';

/**
 * PLATFORM_ADMIN review queue for AI-scored assessment sessions. Access is
 * gated by the backend (RolesGuard) — this page just probes GET
 * /assessment-sessions/review-queue and shows an "admins only" message if
 * that call is rejected, same pattern as admin/assessments.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import AdminNav from '@/components/AdminNav';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

interface ReviewQueueRow {
  sessionId: string;
  candidateId: string;
  skill: string;
  level: string;
  completedAt: string | null;
  counts: { demonstrated: number; partial: number; notEvidenced: number; abstain: number; boundary: number };
  interruptionCount: number;
  needsPriorityReview: boolean;
  reviewedCount: number;
  totalClaims: number;
}

/** Short, stable case identifier — never the candidate's name. */
function caseLabel(sessionId: string): string {
  return `Case ${sessionId.slice(0, 8)}`;
}

function ageLabel(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return '<1h ago';
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Why a case is flagged for priority attention — mirrors the server's needsPriorityReview logic. */
function priorityReason(row: ReviewQueueRow): string | null {
  if (!row.needsPriorityReview) return null;
  const parts: string[] = [];
  if (row.counts.abstain > 0) parts.push(`${row.counts.abstain} abstain${row.counts.abstain === 1 ? '' : 's'}`);
  if (row.counts.boundary > 0) parts.push(`${row.counts.boundary} band boundary${row.counts.boundary === 1 ? '' : 'ies'}`);
  return parts.join(', ');
}

export default function ReviewQueuePage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [rows, setRows] = useState<ReviewQueueRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    api<ReviewQueueRow[]>('/assessment-sessions/review-queue')
      .then((r) => {
        setRows(r);
        setStatus('ok');
      })
      .catch(() => setStatus('forbidden'));
  }, []);

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Admin: Session Reviews</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Admin: Session Reviews</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to review sessions.</p>
      </main>
    );
  }

  return (
    <>
      <AdminNav onLoggedOut={() => router.push('/')} />
      <main className="hub">
        <h1>Session Reviews</h1>
        <p className="hub-subhead">
          AI-scored conversational assessments awaiting a human decision. Cases with an abstain or a band-boundary
          claim surface first, then oldest.
        </p>
        {error && <p className="error">{error}</p>}

        {rows.length === 0 ? (
          <EmptyState message="Nothing awaiting review right now." />
        ) : (
          rows.map((row) => {
            const reason = priorityReason(row);
            return (
              <Link key={row.sessionId} href={`/admin/review/${row.sessionId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card">
                  <div className="assessment-row">
                    <div className="assessment-info">
                      <strong>{caseLabel(row.sessionId)}</strong>{' '}
                      <span className="chip">
                        {row.skill} · {row.level}
                      </span>
                      {reason && (
                        <Badge variant="warning" style={{ marginLeft: 8 }}>
                          needs judgement: {reason}
                        </Badge>
                      )}
                      <div className="meta">
                        {row.counts.demonstrated} demonstrated · {row.counts.partial} partial · {row.counts.notEvidenced}{' '}
                        not evidenced · {row.counts.abstain} abstain
                        {row.interruptionCount > 0 && ` · ${row.interruptionCount} interruption${row.interruptionCount === 1 ? '' : 's'}`}
                      </div>
                    </div>
                    <div className="assessment-meta" style={{ textAlign: 'right' }}>
                      <div>
                        <strong>
                          {row.reviewedCount}/{row.totalClaims}
                        </strong>{' '}
                        reviewed
                      </div>
                      <div className="meta">{ageLabel(row.completedAt)}</div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </main>
    </>
  );
}
