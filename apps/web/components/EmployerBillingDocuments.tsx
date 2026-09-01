'use client';

/**
 * An org's own GST documents (tax invoices/receipts) for assessment-request
 * charges — GET /documents/org, ownership-scoped server-side
 * (DocumentsService.getOwnedByOrg / listForOrg resolve strictly against
 * req.orgId from OrgMemberGuard; there is no id a member of one org could
 * pass to see another org's documents). Read-only, same posture as
 * EmployerApplicants — auth/setup gating comes from app/employer/layout.tsx.
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';
import { Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';

const { api } = employerApi;

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

export default function EmployerBillingDocuments() {
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState('');

  useEffect(() => {
    api<DocumentRow[]>('/documents/org')
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }, []);

  async function download(id: string) {
    setDownloadingId(id);
    try {
      const { url } = await api<{ url: string }>(`/documents/org/${id}/download`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloadingId('');
    }
  }

  return (
    <main className="hub">
      <h1>Billing documents</h1>
      <p>Tax invoices and receipts for your organisation&apos;s assessment-request charges.</p>

      {error && <ErrorState message={error} />}

      {!rows && !error && <LoadingState />}

      {rows && rows.length === 0 && (
        <EmptyState message="No billing documents yet — these appear here after your first paid assessment request." />
      )}

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
  );
}
