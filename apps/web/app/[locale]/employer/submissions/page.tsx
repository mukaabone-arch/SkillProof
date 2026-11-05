'use client';

/**
 * Staffing portal: Submissions — every candidate put forward to a client,
 * with the candidate's approval state and where it stands with the client.
 * "Represents" means this company currently holds the candidate for that
 * client: no other staffing company can submit them there.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import StaffingEmptyState from '@/components/StaffingEmptyState';
import { employerApi } from '@/lib/api';
import { SUBMISSION_ACTION_LABEL, SUBMISSION_NEXT, SUBMISSION_STATUS_LABEL, SubmissionStatus } from '@/lib/staffing';

const { api } = employerApi;

interface Submission {
  id: string;
  client: { id: string; name: string };
  candidateName: string | null;
  ref: string;
  roleTitle: string;
  status: SubmissionStatus;
  representationActive: boolean;
  candidateNote: string | null;
  consentExpiresAt: string;
  createdAt: string;
}

const ACTIVE: SubmissionStatus[] = ['PENDING_CONSENT', 'SUBMITTED', 'INTERVIEWING', 'OFFER'];

export default function StaffingSubmissionsPage() {
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setRows(await api<Submission[]>('/staffing/submissions'));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function move(s: Submission, to: SubmissionStatus) {
    if ((to === 'WITHDRAWN' || to === 'NOT_SELECTED') && !confirm(`${SUBMISSION_ACTION_LABEL[to]} — this ends the submission. Continue?`)) return;
    setBusy(s.id);
    setError('');
    try {
      await api(`/staffing/submissions/${s.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: to }) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const shown = (rows ?? []).filter((r) => filter === 'all' || ACTIVE.includes(r.status));

  return (
    <main className="container-wide">
      <h1>Submissions</h1>
      <p>
        Candidates you&apos;ve put forward to clients. Submit someone from{' '}
        <Link href="/employer/requests">Availability requests</Link> once they&apos;ve said they&apos;re available; they approve
        each client before it counts.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className={filter === 'active' ? '' : 'btn-secondary'} onClick={() => setFilter('active')}>In progress</button>
        <button type="button" className={filter === 'all' ? '' : 'btn-secondary'} onClick={() => setFilter('all')}>All</button>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="meta">Loading…</p>}
      {rows && rows.length === 0 && (
        <StaffingEmptyState
          title="No submissions yet"
          steps={[
            'Find a candidate in Find talent and send them an availability check.',
            'When they say they\'re available, open their card in Availability requests and choose Submit to a client.',
            'They approve within 72 hours — then you represent them to that client, and no other recruiter can submit them there.',
          ]}
          cta={{ href: '/employer/requests', label: 'Go to Availability requests →' }}
        />
      )}
      {rows && rows.length > 0 && shown.length === 0 && (
        <p className="meta">Nothing in progress. Choose All to see earlier submissions.</p>
      )}

      {shown.map((s) => (
        <div key={s.id} className="card staffing-talent">
          <div className="row" style={{ margin: 0, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <strong>{s.candidateName ?? s.ref} → {s.client.name}</strong>
            <span className={`staffing-status staffing-status-${s.status === 'PLACED' || s.status === 'OFFER' ? 'available' : s.status === 'PENDING_CONSENT' ? 'pending' : 'other'}`}>
              {SUBMISSION_STATUS_LABEL[s.status]}
            </span>
          </div>
          <div className="meta">
            {[s.roleTitle, s.representationActive ? 'you represent them here' : null, `created ${new Date(s.createdAt).toLocaleDateString()}`]
              .filter(Boolean)
              .join(' · ')}
            {s.status === 'PENDING_CONSENT' && ` · approval due ${new Date(s.consentExpiresAt).toLocaleString()}`}
          </div>
          {s.candidateNote && <p style={{ margin: '6px 0' }}>&ldquo;{s.candidateNote}&rdquo;</p>}
          {(SUBMISSION_NEXT[s.status] ?? []).length > 0 && (
            <div className="row" style={{ margin: '8px 0 0', flexWrap: 'wrap' }}>
              {(SUBMISSION_NEXT[s.status] ?? []).map((to) => (
                <button
                  key={to}
                  type="button"
                  className={to === 'WITHDRAWN' || to === 'NOT_SELECTED' ? 'btn-secondary' : ''}
                  disabled={busy === s.id}
                  onClick={() => move(s, to)}
                >
                  {SUBMISSION_ACTION_LABEL[to]}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
