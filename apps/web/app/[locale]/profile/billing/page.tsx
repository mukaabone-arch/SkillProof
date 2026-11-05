'use client';

/**
 * A candidate's own GST documents (tax invoices/receipts) for subscription
 * charges — GET /documents/me, ownership-scoped server-side
 * (DocumentsService.getOwnedByCandidateUser resolves this candidate's own
 * BillingProfile from the auth token; there is no id a candidate could pass
 * to see someone else's). Read-only: nothing here is editable, it's just
 * the compliance obligation of "a customer can retrieve their own past
 * documents" — see documents.controller.ts's own doc comment.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import CandidateNav from '@/components/CandidateNav';
import { useRequireAuth } from '@/lib/useRequireAuth';

interface DocumentRow {
  id: string;
  documentNumber: string;
  series: 'TAX_INVOICE' | 'RECEIPT';
  status: 'PENDING' | 'GENERATED' | 'FAILED_NEEDS_ATTENTION';
  totalPaise: number;
  issuedAt: string;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export default function BillingDocumentsPage() {
  const ready = useRequireAuth();
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState('');

  useEffect(() => {
    if (!ready) return;
    api<DocumentRow[]>('/documents/me')
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }, [ready]);

  async function download(id: string) {
    setDownloadingId(id);
    try {
      const { url } = await api<{ url: string }>(`/documents/me/${id}/download`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloadingId('');
    }
  }

  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main className="container-wide">
        <h1>Billing documents</h1>
        <p>Tax invoices and receipts for your MyAmbii Premium subscription charges.</p>

        {error && <ErrorState message={error} />}

        {!rows && !error && <LoadingState />}

        {rows && rows.length === 0 && <EmptyState message="No billing documents yet — these appear here after your first Premium charge." />}

        {rows && rows.length > 0 && (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>
            {rows.map((row, i) => (
              <div
                key={row.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  padding: '14px 20px',
                  borderTop: i === 0 ? undefined : '1px solid var(--gray-200)',
                  margin: 0,
                }}
              >
                <div>
                  <strong>{row.documentNumber}</strong>
                  <div className="meta">
                    {row.series === 'TAX_INVOICE' ? 'Tax invoice' : 'Receipt'} · {new Date(row.issuedAt).toLocaleDateString()} · {rupees(row.totalPaise)}
                  </div>
                </div>
                {row.status === 'GENERATED' ? (
                  <button className="btn-secondary" onClick={() => download(row.id)} disabled={downloadingId === row.id}>
                    {downloadingId === row.id ? 'Opening…' : 'Download'}
                  </button>
                ) : (
                  <span className="meta" style={{ margin: 0 }}>Preparing…</span>
                )}
              </div>
            ))}
          </Card>
        )}
      </main>
    </>
  );
}
