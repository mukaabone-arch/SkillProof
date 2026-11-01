'use client';

/**
 * Candidate: staffing companies asking to put you forward to a named client
 * (approve / decline), plus where each approved submission stands. Approving
 * means that company represents you to that client — no other staffing
 * company can submit you there. Renders nothing until there's at least one.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorState } from '@/components/ui';
import { SUBMISSION_STATUS_LABEL, SubmissionStatus } from '@/lib/staffing';

interface MySubmission {
  id: string;
  orgName: string;
  clientName: string;
  clientIndustry: string | null;
  roleTitle: string;
  status: SubmissionStatus;
  representationActive: boolean;
  consentExpiresAt: string;
}

const WITHDRAWABLE: SubmissionStatus[] = ['SUBMITTED', 'INTERVIEWING', 'OFFER'];

export default function StaffingSubmissionsInbox() {
  const [items, setItems] = useState<MySubmission[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setItems(await api<MySubmission[]>('/staffing/me/submissions'));
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function act(id: string, path: string, body?: object, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(id);
    setError('');
    try {
      await api(`/staffing/me/submissions/${id}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!items || items.length === 0) return null;
  const pending = items.filter((s) => s.status === 'PENDING_CONSENT');
  const rest = items.filter((s) => s.status !== 'PENDING_CONSENT');

  return (
    <section className="staffing-inbox">
      <h2>Through recruiters</h2>
      {error && <ErrorState message={error} />}

      {pending.map((s) => (
        <div key={s.id} className="card staffing-request">
          <strong>{s.orgName} wants to put you forward to {s.clientName}</strong>
          <div className="meta">
            {s.roleTitle}
            {s.clientIndustry ? ` · ${s.clientIndustry}` : ''} · decide by {new Date(s.consentExpiresAt).toLocaleString()}
          </div>
          <p className="meta" style={{ margin: '6px 0' }}>
            If you approve, {s.orgName} represents you to {s.clientName}, and no other recruiter can submit you there
            while it lasts.
          </p>
          <div className="row" style={{ margin: 0, flexWrap: 'wrap' }}>
            <button disabled={busy === s.id} onClick={() => act(s.id, 'decide', { approve: true })}>Approve</button>
            <button className="btn-secondary" disabled={busy === s.id} onClick={() => act(s.id, 'decide', { approve: false })}>Decline</button>
          </div>
        </div>
      ))}

      {rest.map((s) => (
        <div key={s.id} className="row staffing-submission-row">
          <span>
            <strong>{s.roleTitle}</strong> at {s.clientName} <span className="meta">via {s.orgName}</span>
          </span>
          <span className="row" style={{ margin: 0, gap: 8 }}>
            <span className="meta">{SUBMISSION_STATUS_LABEL[s.status]}</span>
            {WITHDRAWABLE.includes(s.status) && (
              <button
                type="button"
                className="btn-link"
                disabled={busy === s.id}
                onClick={() => act(s.id, 'withdraw', undefined, `Withdraw from ${s.clientName}? ${s.orgName} will no longer represent you there.`)}
              >
                Withdraw
              </button>
            )}
          </span>
        </div>
      ))}
    </section>
  );
}
