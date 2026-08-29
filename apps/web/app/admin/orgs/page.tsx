'use client';

/**
 * Organization Verification — the review queue for
 * OrgVerificationStatus.PENDING requests (see AdminService.decideOrgVerification
 * and Organization's own doc comment in schema.prisma). Verification is a
 * signal, never a gate — nothing here can lock an org out of posting,
 * applying, hiring, or billing; approving/rejecting only changes the badge
 * candidates and other employers see. Sidebar/topbar come from
 * app/admin/layout.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken } from '@/lib/api';
import { Badge, EmptyState, LoadingState } from '@/components/ui';
import { formatOrgIndustry, OrgIndustry } from '@/lib/orgIndustry';

type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

interface OrgRow {
  id: string;
  name: string;
  code: string;
  industry: OrgIndustry | null;
  industryOther: string | null;
  website: string | null;
  verificationStatus: VerificationStatus;
  verificationSubmittedAt: string | null;
  verificationSubmittedByUser: { id: string; email: string | null; phone: string | null } | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  /** Set by an EMPLOYER_ADMIN's own self-service deactivation — a real access gate, unlike verificationStatus's "signal, never a gate." Reactivation (below) is the only way to clear it. */
  deactivatedAt: string | null;
  deactivatedByUser: { id: string; email: string | null; phone: string | null } | null;
}

const STATUS_BADGE: Record<VerificationStatus, { variant: 'neutral' | 'warning' | 'verified' | 'danger'; label: string }> = {
  UNVERIFIED: { variant: 'neutral', label: 'Not verified' },
  PENDING: { variant: 'warning', label: 'Pending review' },
  VERIFIED: { variant: 'verified', label: 'Verified' },
  REJECTED: { variant: 'danger', label: 'Rejected' },
};

type StatusFilter = 'PENDING' | 'ALL' | VerificationStatus;

function memberLabel(u: OrgRow['verificationSubmittedByUser']): string {
  if (!u) return '—';
  return u.email ?? u.phone ?? u.id.slice(0, 8);
}

function fmtDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export default function AdminOrgVerificationPage() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('PENDING');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  // Same "never loaded vs. was fine a moment ago" distinction as the
  // Compliance Center page — a ref so the catch handler always reads the
  // latest value rather than one captured when this callback was created.
  const everLoaded = useRef(false);

  const load = useCallback(() => {
    const qs = filter === 'ALL' ? '' : `?verificationStatus=${filter}`;
    api<OrgRow[]>(`/admin/orgs${qs}`)
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
  }, [filter]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, [load]);

  async function approve(id: string) {
    setError('');
    setBusyId(id);
    try {
      await api(`/admin/orgs/${id}/verification`, { method: 'PATCH', body: JSON.stringify({ status: 'VERIFIED' }) });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function startReject(id: string) {
    setRejectingId(id);
    setRejectionReason('');
  }

  async function confirmReject(id: string) {
    if (!rejectionReason.trim()) return;
    setError('');
    setBusyId(id);
    try {
      await api(`/admin/orgs/${id}/verification`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'REJECTED', rejectionReason: rejectionReason.trim() }),
      });
      setRejectingId(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** The only way to clear an org's self-service deactivation — see AdminService.reactivateOrg. Does not reopen any job the deactivation closed. */
  async function reactivate(id: string) {
    setError('');
    setBusyId(id);
    try {
      await api(`/admin/orgs/${id}/reactivate`, { method: 'PATCH' });
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
        <h1>Organization Verification</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Organization Verification</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to review verification requests.</p>
      </main>
    );
  }

  return (
    <main className="hub">
      <h1>Organization Verification</h1>
      <p className="hub-subhead">
        A verified badge is a signal, not a gate — an org can post jobs, apply, hire, and pay whether or not it&apos;s
        verified. Approving or rejecting a request only changes what candidates and other employers see. Deactivation
        (below, when present) is unrelated and is a real gate — an EMPLOYER_ADMIN can deactivate their own org, but
        only a platform admin can reactivate it, which is the one action on this page that isn&apos;t about
        verification.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="field" style={{ minWidth: 180, margin: 0 }}>
          <label htmlFor="filterStatus">Status</label>
          <select id="filterStatus" value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)}>
            <option value="PENDING">Pending review</option>
            <option value="ALL">All</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
            <option value="UNVERIFIED">Not verified</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No organizations match this filter." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((row) => (
            <div key={row.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0, flexWrap: 'wrap' }}>
                <div className="row" style={{ margin: 0, alignItems: 'center' }}>
                  <strong>{row.name}</strong>
                  <span className="meta" style={{ margin: 0 }}>{row.code}</span>
                  <Badge variant={STATUS_BADGE[row.verificationStatus].variant}>
                    {STATUS_BADGE[row.verificationStatus].label}
                  </Badge>
                  {row.deactivatedAt && <Badge variant="danger">Deactivated</Badge>}
                </div>
                <div className="row" style={{ margin: 0 }}>
                  {row.deactivatedAt ? (
                    <button onClick={() => reactivate(row.id)} disabled={busyId === row.id}>
                      {busyId === row.id ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  ) : (
                    row.verificationStatus === 'PENDING' && (
                      <>
                        <button onClick={() => approve(row.id)} disabled={busyId === row.id}>
                          {busyId === row.id && rejectingId !== row.id ? 'Approving…' : 'Approve'}
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => startReject(row.id)}
                          disabled={busyId === row.id}
                        >
                          Reject
                        </button>
                      </>
                    )
                  )}
                </div>
              </div>

              <div className="meta">
                {formatOrgIndustry(row.industry, row.industryOther) ?? 'Industry not set'} ·{' '}
                {row.website || 'Website not set'}
              </div>
              {row.deactivatedAt && (
                <div className="meta">
                  Deactivated {fmtDateTime(row.deactivatedAt)} by {memberLabel(row.deactivatedByUser)}
                </div>
              )}
              <div className="meta">
                Submitted {fmtDateTime(row.verificationSubmittedAt)} by {memberLabel(row.verificationSubmittedByUser)}
              </div>
              {row.verificationStatus === 'REJECTED' && row.rejectionReason && (
                <div className="meta">Rejection reason: {row.rejectionReason}</div>
              )}

              {rejectingId === row.id && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <label htmlFor={`reason-${row.id}`} className="meta" style={{ margin: 0 }}>
                    Rejection reason (shown to the employer)
                  </label>
                  <textarea
                    id={`reason-${row.id}`}
                    rows={2}
                    maxLength={1000}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                  <div className="row" style={{ margin: 0 }}>
                    <button
                      onClick={() => confirmReject(row.id)}
                      disabled={busyId === row.id || !rejectionReason.trim()}
                    >
                      {busyId === row.id ? 'Rejecting…' : 'Confirm reject'}
                    </button>
                    <button className="btn-secondary" onClick={() => setRejectingId(null)} disabled={busyId === row.id}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
