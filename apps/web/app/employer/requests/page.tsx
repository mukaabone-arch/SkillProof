'use client';

/**
 * Staffing portal: Availability requests (GET /staffing/requests). Every
 * request this company sent, newest first. Name and contact details appear
 * only once the candidate answered "available" (with or without
 * conditions), and only while their account is still active.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import { REQUEST_STATUS_LABEL, ROLE_TITLE_LABEL, RequestStatus, WORK_TYPE_LABEL, WorkType } from '@/lib/staffing';

const { api } = employerApi;

interface OrgRequest {
  id: string;
  ref: string;
  roleTitle: string;
  workType: WorkType;
  clientName: string | null;
  status: RequestStatus;
  candidateMessage: string | null;
  createdAt: string;
  expiresAt: string;
  candidateRoleTitle: string | null;
  candidateLocation: string | null;
  contact: {
    fullName: string | null;
    headline: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
  } | null;
}

const FILTERS: { key: string; label: string; match: (s: RequestStatus) => boolean }[] = [
  { key: 'yes', label: 'Available', match: (s) => s === 'AVAILABLE' || s === 'CONDITIONAL' },
  { key: 'open', label: 'Waiting', match: (s) => s === 'PENDING' },
  { key: 'all', label: 'All', match: () => true },
];

export default function StaffingRequestsPage() {
  const [rows, setRows] = useState<OrgRequest[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api<OrgRequest[]>('/staffing/requests').then(setRows).catch((e) => setError((e as Error).message));
  }, []);

  async function withdraw(id: string) {
    try {
      await api(`/staffing/requests/${id}/withdraw`, { method: 'POST' });
      setRows((r) => (r ?? []).map((x) => (x.id === id ? { ...x, status: 'WITHDRAWN' } : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const f = FILTERS.find((x) => x.key === filter)!;
  const shown = (rows ?? []).filter((r) => f.match(r.status));

  return (
    <main className="container-wide">
      <h1>Availability requests</h1>
      <p>
        Candidates you&apos;ve asked about. Contact details appear here once a candidate says they&apos;re available.{' '}
        <Link href="/employer/talent">Find more talent →</Link>
      </p>
      <div className="row" style={{ gap: 8 }}>
        {FILTERS.map((x) => (
          <button key={x.key} type="button" className={x.key === filter ? '' : 'btn-secondary'} onClick={() => setFilter(x.key)}>
            {x.label}
            {rows ? ` (${rows.filter((r) => x.match(r.status)).length})` : ''}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="meta">Loading…</p>}
      {rows && shown.length === 0 && <p className="meta">Nothing here yet.</p>}

      {shown.map((r) => (
        <div key={r.id} className="card staffing-talent">
          <div className="row" style={{ margin: 0, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <strong>
              {r.contact?.fullName ?? r.ref} · {r.roleTitle}
            </strong>
            <span className={`staffing-status staffing-status-${r.status.toLowerCase()}`}>{REQUEST_STATUS_LABEL[r.status]}</span>
          </div>
          <div className="meta">
            {[
              WORK_TYPE_LABEL[r.workType],
              r.clientName ? `for ${r.clientName}` : null,
              r.candidateRoleTitle ? ROLE_TITLE_LABEL[r.candidateRoleTitle] ?? r.candidateRoleTitle : null,
              r.candidateLocation,
              `sent ${new Date(r.createdAt).toLocaleDateString()}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {r.candidateMessage && <p style={{ margin: '6px 0' }}>&ldquo;{r.candidateMessage}&rdquo;</p>}
          {r.contact && (
            <div className="staffing-contact">
              {r.contact.headline && <div>{r.contact.headline}</div>}
              {r.contact.email && <div>Email: <a href={`mailto:${r.contact.email}`}>{r.contact.email}</a></div>}
              {r.contact.phone && <div>Phone: <a href={`tel:${r.contact.phone}`}>{r.contact.phone}</a></div>}
              {r.contact.linkedinUrl && <div><a href={r.contact.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a></div>}
              {r.contact.githubUrl && <div><a href={r.contact.githubUrl} target="_blank" rel="noopener noreferrer">GitHub</a></div>}
            </div>
          )}
          {r.status === 'PENDING' && (
            <div className="row" style={{ margin: '8px 0 0', justifyContent: 'space-between' }}>
              <span className="meta">Expires {new Date(r.expiresAt).toLocaleString()}</span>
              <button className="btn-secondary" onClick={() => withdraw(r.id)}>Withdraw</button>
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
