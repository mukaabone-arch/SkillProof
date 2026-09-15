'use client';

/**
 * Integrity Blocks — the admin view of AssessmentBlock rows (2026-09
 * 24-hour integrity block feature; see AdminService.listAssessmentBlocks /
 * liftAssessmentBlock). Every block ever raised, most recent first,
 * including lifted and expired ones — the audit history is never deleted
 * (see that model's own schema doc comment), so a candidate's appeal or a
 * disputed employer charge can always be traced back to the two attempts
 * that triggered it. Sidebar/topbar come from app/admin/layout.tsx.
 *
 * Deliberately shows `reason`/trigger-attempt detail here — unlike the
 * candidate-facing AssessmentBlockedModal and the employer-facing
 * AssessmentRequest record (dates only), this is the one surface allowed
 * to carry the full evidential detail, since it's the one place an actual
 * review decision gets made.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken } from '@/lib/api';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

interface TriggerAttempt {
  id: string;
  createdAt: string;
  integrityFlagCount: number;
  assessment: { title: string } | null;
}

interface BlockRow {
  id: string;
  userId: string;
  skillId: string | null;
  startedAt: string;
  expiresAt: string;
  triggerAttemptIds: string[];
  triggerAttempts: (TriggerAttempt | null)[];
  reason: string;
  liftedAt: string | null;
  liftedByUserId: string | null;
  liftedNote: string | null;
  createdAt: string;
  user: { id: string; phone: string | null; email: string | null; profile: { fullName: string | null } | null };
  skill: { name: string } | null;
  liftedByUser: { id: string; email: string | null; phone: string | null } | null;
}

interface ListResponse {
  summary: { totalRaised: number; totalLifted: number; currentlyActive: number };
  blocks: BlockRow[];
}

type StatusFilter = 'ACTIVE' | 'ALL';

function fmtDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function candidateLabel(u: BlockRow['user']): string {
  return u.profile?.fullName ?? u.email ?? u.phone ?? u.id.slice(0, 8);
}

function actorLabel(u: BlockRow['liftedByUser']): string {
  if (!u) return '—';
  return u.email ?? u.phone ?? u.id.slice(0, 8);
}

function isCurrentlyActive(row: BlockRow): boolean {
  return !row.liftedAt && new Date(row.expiresAt) > new Date();
}

export default function AdminAssessmentBlocksPage() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('ACTIVE');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [liftingId, setLiftingId] = useState<string | null>(null);
  const [liftNote, setLiftNote] = useState('');
  const everLoaded = useRef(false);

  const load = useCallback(() => {
    api<ListResponse>('/admin/assessment-blocks')
      .then((r) => {
        setData(r);
        setStatus('ok');
        setError('');
        everLoaded.current = true;
      })
      .catch((e) => {
        if (!everLoaded.current) setStatus('forbidden');
        else setError(e.message);
      });
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, [load]);

  function startLift(id: string) {
    setLiftingId(id);
    setLiftNote('');
  }

  async function confirmLift(id: string) {
    setError('');
    setBusyId(id);
    try {
      await api(`/admin/assessment-blocks/${id}/lift`, {
        method: 'PATCH',
        body: JSON.stringify(liftNote.trim() ? { note: liftNote.trim() } : {}),
      });
      setLiftingId(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Integrity Blocks</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Integrity Blocks</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to review integrity blocks.</p>
      </main>
    );
  }

  const rows = data!.blocks.filter((r) => filter === 'ALL' || isCurrentlyActive(r));

  return (
    <main className="hub">
      <h1>Integrity Blocks</h1>
      <p className="hub-subhead">
        Raised automatically when a candidate has two attempts, for the same skill within a rolling 7-day window,
        that each reach the deliberate-signal threshold (paste/copy only — never tab focus, right-click, or a fast
        answer alone). Bars starting a new MCQ attempt for any skill; never terminates one already in progress, and
        never touches sign-in, applying, badges, or discussion-format sessions. Lifting early is the only way to
        clear one before it expires on its own — the row itself is never deleted.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8, gap: 24 }}>
        <span className="meta">Raised: {data!.summary.totalRaised}</span>
        <span className="meta">Lifted on appeal: {data!.summary.totalLifted}</span>
        <span className="meta">Currently active: {data!.summary.currentlyActive}</span>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="field" style={{ minWidth: 180, margin: 0 }}>
          <label htmlFor="filterStatus">Show</label>
          <select id="filterStatus" value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)}>
            <option value="ACTIVE">Currently active</option>
            <option value="ALL">All (including lifted/expired)</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState message={filter === 'ACTIVE' ? 'No active blocks.' : 'No blocks have ever been raised.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((row) => {
            const active = isCurrentlyActive(row);
            return (
              <div key={row.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between', margin: 0, flexWrap: 'wrap' }}>
                  <div className="row" style={{ margin: 0, alignItems: 'center' }}>
                    <strong>{candidateLabel(row.user)}</strong>
                    <span className="meta" style={{ margin: 0 }}>{row.skill?.name ?? 'Unknown skill'}</span>
                    {active ? (
                      <Badge variant="danger">Active</Badge>
                    ) : row.liftedAt ? (
                      <Badge variant="verified">Lifted</Badge>
                    ) : (
                      <Badge variant="neutral">Expired</Badge>
                    )}
                  </div>
                  {active && (
                    <div className="row" style={{ margin: 0 }}>
                      <button onClick={() => startLift(row.id)} disabled={busyId === row.id}>
                        Lift early
                      </button>
                    </div>
                  )}
                </div>

                <div className="meta">
                  Raised {fmtDateTime(row.startedAt)} · expires {fmtDateTime(row.expiresAt)}
                </div>
                <div className="meta">Reason: {row.reason}</div>
                <div className="meta">
                  Trigger attempts:{' '}
                  {row.triggerAttempts.map((a, i) => (a ? `${a.assessment?.title ?? a.id} (${a.integrityFlagCount} flags)` : 'deleted')).join(', ') || '—'}
                </div>
                {row.liftedAt && (
                  <div className="meta">
                    Lifted {fmtDateTime(row.liftedAt)} by {actorLabel(row.liftedByUser)}
                    {row.liftedNote && ` — ${row.liftedNote}`}
                  </div>
                )}

                {liftingId === row.id && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    <label htmlFor={`lift-note-${row.id}`} className="meta" style={{ margin: 0 }}>
                      Note (optional, for the audit trail)
                    </label>
                    <textarea
                      id={`lift-note-${row.id}`}
                      rows={2}
                      maxLength={1000}
                      value={liftNote}
                      onChange={(e) => setLiftNote(e.target.value)}
                    />
                    <div className="row" style={{ margin: 0 }}>
                      <button onClick={() => confirmLift(row.id)} disabled={busyId === row.id}>
                        {busyId === row.id ? 'Lifting…' : 'Confirm lift'}
                      </button>
                      <button className="btn-secondary" onClick={() => setLiftingId(null)} disabled={busyId === row.id}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
