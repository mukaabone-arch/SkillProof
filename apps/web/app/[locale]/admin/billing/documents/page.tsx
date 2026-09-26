'use client';

/**
 * GST documents (tax invoices/receipts) — admin visibility. The one thing
 * this page exists to make impossible to miss: a document stuck
 * FAILED_NEEDS_ATTENTION is a compliance gap, not a lost email (see
 * DocumentStatus's own schema doc comment) — DocumentsGenerationJob's
 * hourly sweep stops retrying it automatically once it's here, so a human
 * has to see it and act. That's why these rows get their own banner
 * section above the fold, not just a filter option someone has to think to
 * apply. Access is gated by the backend (RolesGuard) — this page just
 * probes GET /admin/documents and shows an "admins only" message on a 403,
 * same pattern as every other page in this console.
 */
import { useEffect, useState } from 'react';
import { api, getToken } from '@/lib/api';
import { Badge, EmptyState, LoadingState } from '@/components/ui';

interface DocumentRow {
  id: string;
  documentNumber: string;
  series: 'TAX_INVOICE' | 'RECEIPT';
  status: 'PENDING' | 'GENERATED' | 'FAILED_NEEDS_ATTENTION';
  totalPaise: number;
  issuedAt: string;
  generationAttempts: number;
  lastGenerationError: string | null;
}

const STATUS_VARIANT: Record<DocumentRow['status'], 'danger' | 'warning' | 'verified'> = {
  FAILED_NEEDS_ATTENTION: 'danger',
  PENDING: 'warning',
  GENERATED: 'verified',
};

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export default function AdminDocumentsPage() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [error, setError] = useState('');
  const [retryingId, setRetryingId] = useState('');

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, []);

  function load() {
    api<DocumentRow[]>('/admin/documents')
      .then((r) => {
        setRows(r);
        setStatus('ok');
      })
      .catch((e) => {
        setError(e.message);
        setStatus('forbidden');
      });
  }

  async function retry(id: string) {
    setRetryingId(id);
    try {
      await api(`/admin/documents/${id}/retry`, { method: 'POST' });
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
        <h1>GST Documents</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>GST Documents</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account.</p>
      </main>
    );
  }

  const needsAttention = rows.filter((r) => r.status === 'FAILED_NEEDS_ATTENTION');
  const rest = rows.filter((r) => r.status !== 'FAILED_NEEDS_ATTENTION');

  return (
    <main className="hub">
      <h1>GST Documents</h1>
      <p className="hub-subhead">Tax invoices and receipts generated for GST-bearing charges.</p>
      {error && <p className="error">{error}</p>}

      {needsAttention.length > 0 && (
        <div
          className="card"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, marginBottom: 24, borderColor: 'var(--error)' }}
        >
          <h2 style={{ margin: 0 }}>
            <span className="error">Needs attention</span> — {needsAttention.length} document{needsAttention.length === 1 ? '' : 's'} failed to generate
          </h2>
          <p className="meta" style={{ margin: 0 }}>
            These exhausted their automatic retries. Fix the underlying issue (check lastGenerationError below), then retry.
          </p>
          {needsAttention.map((row) => (
            <div key={row.id} className="card" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>{row.documentNumber}</strong> <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                <div className="meta">
                  {rupees(row.totalPaise)} · issued {new Date(row.issuedAt).toLocaleDateString()} · {row.generationAttempts} attempt
                  {row.generationAttempts === 1 ? '' : 's'}
                </div>
                {row.lastGenerationError && <div className="error" style={{ fontSize: '0.85em' }}>{row.lastGenerationError}</div>}
              </div>
              <button onClick={() => retry(row.id)} disabled={retryingId === row.id}>
                {retryingId === row.id ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 8 }}>All documents</h2>
      {rest.length === 0 ? (
        <EmptyState message="No other documents yet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rest.map((row) => (
            <div key={row.id} className="card" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{row.documentNumber}</strong> <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                <div className="meta">{row.series === 'TAX_INVOICE' ? 'Tax invoice' : 'Receipt'} · {rupees(row.totalPaise)}</div>
              </div>
              <span className="meta" style={{ margin: 0 }}>{new Date(row.issuedAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
