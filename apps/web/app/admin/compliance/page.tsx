'use client';

/**
 * Compliance Center — Privacy Requests. A record-and-audit view over
 * account deactivations/reactivations/deletions that have already
 * executed — never an approval gate. Candidate-initiated deletion and
 * deactivation stay immediate and self-service (erasure is a legal right
 * under GDPR Article 17 / India's DPDP Act, not something an admin
 * grants); this page cannot approve, reject, delay, or otherwise gate any
 * of it. Access is gated by the backend (RolesGuard, PLATFORM_ADMIN) —
 * same pattern as /admin/review — this page just probes GET
 * /admin/account-actions and shows an "admins only" message if rejected.
 *
 * What this page can and can't honestly show — see
 * AccountService.listActionsForAdmin's own doc comment for the full
 * reasoning: confirmationEmailStatus is a real, exactly-attributable fact
 * (one email per action, paired in strict chronological order).
 * pipelinesUnavailable and candidateHasFailedRefund are the candidate's
 * *current* live state, only ever attached to their most recent
 * unavailability-causing action — not a historical count of what that
 * specific action caused, because no such count is stored anywhere.
 * Nothing here ever shows a scrubbed name or email — only the short,
 * anonymous candidateRef (mirrors /admin/review's "Case {id}" convention).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import AdminNav from '@/components/AdminNav';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

type ActionType = 'DEACTIVATED' | 'REACTIVATED' | 'DELETED';
type ReasonCategory =
  | 'FOUND_JOB_SKILLPROOF'
  | 'FOUND_JOB_ELSEWHERE'
  | 'NOT_FINDING_ROLES'
  | 'TOO_MANY_EMAILS'
  | 'PRIVACY_CONCERNS'
  | 'OTHER';
type NotificationStatus = 'QUEUED' | 'SENT' | 'FAILED';
type StatusFilter = 'ALL' | 'NEEDS_ATTENTION' | 'CLEAN';

interface AccountActionRow {
  id: string;
  type: ActionType;
  reasonCategory: ReasonCategory | null;
  createdAt: string;
  candidateRef: string;
  candidateCurrentlyDeactivated: boolean;
  candidateCurrentlyDeleted: boolean;
  confirmationEmailStatus: NotificationStatus | null;
  pipelinesUnavailable: number | null;
  candidateHasFailedRefund: boolean;
  needsAttention: boolean;
}

const TYPE_LABEL: Record<ActionType, string> = {
  DEACTIVATED: 'Deactivation',
  REACTIVATED: 'Reactivation',
  DELETED: 'Deletion',
};

const TYPE_BADGE_VARIANT: Record<ActionType, 'neutral' | 'verified' | 'danger'> = {
  DEACTIVATED: 'neutral',
  REACTIVATED: 'verified',
  DELETED: 'danger',
};

/** Matches profile/account/page.tsx's REASON_OPTIONS wording exactly — same exit-survey copy, read back here. */
const REASON_LABEL: Record<ReasonCategory, string> = {
  FOUND_JOB_SKILLPROOF: 'Found a job through SkillProof',
  FOUND_JOB_ELSEWHERE: 'Found a job elsewhere',
  NOT_FINDING_ROLES: 'Not finding relevant roles',
  TOO_MANY_EMAILS: 'Too many emails',
  PRIVACY_CONCERNS: 'Privacy concerns',
  OTHER: 'Other',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One line, never more — the whole point of this column is a quick scan, and the failure detail already has its own row in the panel above. */
function attentionReason(row: AccountActionRow): string {
  const parts: string[] = [];
  if (row.confirmationEmailStatus === 'FAILED') parts.push('confirmation email failed to send');
  if (row.candidateHasFailedRefund) parts.push('has a stuck refund (REFUND_FAILED)');
  return parts.join(' · ');
}

export default function CompliancePrivacyRequestsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [rows, setRows] = useState<AccountActionRow[]>([]);
  const [error, setError] = useState('');

  const [type, setType] = useState<ActionType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  // Distinguishes "never successfully loaded, so a failure means forbidden"
  // from "was fine a moment ago, so a later failure is just an error to
  // show" — a ref rather than reading `status` in the closure below, which
  // would otherwise capture whatever it was when this callback was last
  // created, not the latest value.
  const everLoaded = useRef(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    const qs = params.toString();

    api<AccountActionRow[]>(`/admin/account-actions${qs ? `?${qs}` : ''}`)
      .then((r) => {
        setRows(r);
        setStatus('ok');
        setError('');
        everLoaded.current = true;
      })
      .catch((e) => {
        if (!everLoaded.current) setStatus('forbidden');
        else setError(e.message);
      });
  }, [type, from, to, statusFilter]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, [load]);

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Compliance Center — Privacy Requests</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Compliance Center — Privacy Requests</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to view privacy requests.</p>
      </main>
    );
  }

  const needsAttention = rows.filter((r) => r.needsAttention);

  return (
    <>
      <AdminNav onLoggedOut={() => router.push('/')} />
      <main className="hub">
        <h1>Compliance Center — Privacy Requests</h1>
        <p className="hub-subhead">
          A record of account deactivations, reactivations, and deletions that have already executed. This is an
          audit view, not an approval queue — erasure is a candidate&apos;s legal right and nothing here can delay
          or reverse it.
        </p>
        {error && <p className="error">{error}</p>}

        <div className="hub-section">
          <div className="hub-section-head">
            <h2>Needs attention</h2>
          </div>
          {needsAttention.length === 0 ? (
            <EmptyState message="Nothing stuck right now — every recorded action has a clean trail." />
          ) : (
            needsAttention.map((row) => (
              <div key={row.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                  <div className="row" style={{ margin: 0, alignItems: 'center' }}>
                    <Badge variant={TYPE_BADGE_VARIANT[row.type]}>{TYPE_LABEL[row.type]}</Badge>
                    <strong>Candidate {row.candidateRef}</strong>
                  </div>
                  <span className="meta" style={{ margin: 0 }}>{formatDateTime(row.createdAt)}</span>
                </div>
                <Badge variant="danger" style={{ alignSelf: 'flex-start' }}>
                  {attentionReason(row)}
                </Badge>
              </div>
            ))
          )}
        </div>

        <div className="hub-section">
          <div className="hub-section-head">
            <h2>All privacy requests</h2>
          </div>

          <div className="row" style={{ flexWrap: 'wrap', marginBottom: 20 }}>
            <div className="field" style={{ minWidth: 160, margin: 0 }}>
              <label htmlFor="filterType">Action type</label>
              <select id="filterType" value={type} onChange={(e) => setType(e.target.value as ActionType | '')}>
                <option value="">All types</option>
                <option value="DEACTIVATED">Deactivation</option>
                <option value="REACTIVATED">Reactivation</option>
                <option value="DELETED">Deletion</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 160, margin: 0 }}>
              <label htmlFor="filterFrom">From</label>
              <input id="filterFrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: 160, margin: 0 }}>
              <label htmlFor="filterTo">To</label>
              <input id="filterTo" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: 160, margin: 0 }}>
              <label htmlFor="filterStatus">Status</label>
              <select id="filterStatus" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="ALL">All</option>
                <option value="NEEDS_ATTENTION">Needs attention</option>
                <option value="CLEAN">Clean</option>
              </select>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState message="No account actions match these filters." />
          ) : (
            rows.map((row) => (
              <div key={row.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                  <div className="row" style={{ margin: 0, alignItems: 'center' }}>
                    <Badge variant={TYPE_BADGE_VARIANT[row.type]}>{TYPE_LABEL[row.type]}</Badge>
                    <strong>Candidate {row.candidateRef}</strong>
                    {row.needsAttention && <Badge variant="danger">Needs attention</Badge>}
                  </div>
                  <span className="meta" style={{ margin: 0 }}>{formatDateTime(row.createdAt)}</span>
                </div>

                <div className="meta">
                  Reason: {row.reasonCategory ? REASON_LABEL[row.reasonCategory] : 'Skipped'}
                </div>

                <div className="meta">
                  {row.type !== 'REACTIVATED' && (
                    <>
                      Confirmation email:{' '}
                      {row.confirmationEmailStatus === 'FAILED'
                        ? '❌ failed to send'
                        : row.confirmationEmailStatus === 'SENT'
                          ? '✓ sent'
                          : 'queued'}
                      {' · '}
                    </>
                  )}
                  {row.pipelinesUnavailable !== null ? (
                    <>Pipelines currently unavailable: {row.pipelinesUnavailable}</>
                  ) : (
                    <>No live pipeline effect from this action (superseded, or none applied)</>
                  )}
                  {row.candidateHasFailedRefund && ' · has a stuck refund (REFUND_FAILED)'}
                </div>

                <div className="meta">
                  Candidate is currently{' '}
                  {row.candidateCurrentlyDeleted ? 'deleted' : row.candidateCurrentlyDeactivated ? 'deactivated' : 'active'}.
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </>
  );
}
