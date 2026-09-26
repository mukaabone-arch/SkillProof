'use client';

/**
 * Compliance Center — Data Exports. A record of "download my data"
 * requests and their fulfilment, so an admin can see whether exports are
 * being generated and spot failures — never a queue that approves or
 * gates them (same posture as the Privacy Requests page one level up:
 * portability is a legal right, not something granted here). Deliberately
 * shows status/timestamps only, never the exported content — an admin
 * doesn't need to read a candidate's data to confirm delivery, and this
 * page's own GET call is itself logged by DataExportService.listForAdmin
 * (AdminAccessLog), same access-logging pattern candidate-record admin
 * views are adopting. Only candidateRef (a short opaque id prefix, never a
 * name/email) identifies a row — same convention as ../page.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

type ExportStatus = 'REQUESTED' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';

interface ExportRequestRow {
  id: string;
  candidateRef: string;
  status: ExportStatus;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  failureReason: string | null;
  fileSizeBytes: number | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
}

const STATUS_BADGE: Record<ExportStatus, { variant: 'neutral' | 'warning' | 'verified' | 'danger'; label: string }> = {
  REQUESTED: { variant: 'neutral', label: 'Queued' },
  PROCESSING: { variant: 'warning', label: 'Processing' },
  READY: { variant: 'verified', label: 'Ready' },
  FAILED: { variant: 'danger', label: 'Failed' },
  EXPIRED: { variant: 'neutral', label: 'Expired' },
};

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export default function ComplianceDataExportsPage() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [rows, setRows] = useState<ExportRequestRow[]>([]);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<ExportStatus | ''>('');
  const [retryingId, setRetryingId] = useState('');
  const everLoaded = useRef(false);

  const load = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    api<ExportRequestRow[]>(`/admin/export-requests${qs}`)
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
  }, [statusFilter]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, [load]);

  async function retry(id: string) {
    setRetryingId(id);
    try {
      await api(`/admin/export-requests/${id}/retry`, { method: 'POST' });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetryingId('');
    }
  }

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Compliance Center — Data Exports</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Compliance Center — Data Exports</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to view export requests.</p>
      </main>
    );
  }

  const failed = rows.filter((r) => r.status === 'FAILED');

  return (
    <main className="hub">
      <h1>Compliance Center — Data Exports</h1>
      <p className="hub-subhead">
        Candidate &quot;download my data&quot; requests and their fulfilment. Content is never shown here — only
        status and timestamps. See <Link href="/admin/compliance">Privacy Requests</Link> for account
        deactivation/deletion history.
      </p>
      {error && <p className="error">{error}</p>}

      {failed.length > 0 && (
        <div className="hub-section">
          <div className="hub-section-head">
            <h2>Needs attention</h2>
          </div>
          {failed.map((row) => (
            <div key={row.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <div className="row" style={{ margin: 0, alignItems: 'center' }}>
                  <Badge variant="danger">Failed</Badge>
                  <strong>Candidate {row.candidateRef}</strong>
                </div>
                <button className="btn-secondary" onClick={() => retry(row.id)} disabled={retryingId === row.id}>
                  {retryingId === row.id ? 'Retrying…' : 'Retry'}
                </button>
              </div>
              {row.failureReason && <div className="meta">Reason: {row.failureReason}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="hub-section">
        <div className="hub-section-head">
          <h2>All export requests</h2>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 20 }}>
          <div className="field" style={{ minWidth: 160, margin: 0 }}>
            <label htmlFor="filterStatus">Status</label>
            <select
              id="filterStatus"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ExportStatus | '')}
            >
              <option value="">All</option>
              <option value="REQUESTED">Queued</option>
              <option value="PROCESSING">Processing</option>
              <option value="READY">Ready</option>
              <option value="FAILED">Failed</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState message="No export requests match these filters." />
        ) : (
          rows.map((row) => (
            <div key={row.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <div className="row" style={{ margin: 0, alignItems: 'center' }}>
                  <Badge variant={STATUS_BADGE[row.status].variant}>{STATUS_BADGE[row.status].label}</Badge>
                  <strong>Candidate {row.candidateRef}</strong>
                </div>
                <span className="meta" style={{ margin: 0 }}>Requested {formatDateTime(row.requestedAt)}</span>
              </div>
              <div className="meta">
                Completed: {formatDateTime(row.completedAt)} · Expires: {formatDateTime(row.expiresAt)}
                {row.fileSizeBytes != null && ` · ${(row.fileSizeBytes / 1024).toFixed(1)} KB`}
              </div>
              <div className="meta">
                Downloads: {row.downloadCount}
                {row.lastDownloadedAt && ` · last at ${formatDateTime(row.lastDownloadedAt)}`}
              </div>
              {row.failureReason && <div className="meta">Failure: {row.failureReason}</div>}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
