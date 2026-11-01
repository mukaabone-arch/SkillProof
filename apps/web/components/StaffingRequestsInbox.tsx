'use client';

/**
 * The candidate's inbox of staffing-company availability checks (GET
 * /staffing/me/requests). Renders nothing until there's at least one. An
 * open request offers "I'm available", "Interested, with conditions" and
 * "Not right now" — saying yes (either way) is what shares the candidate's
 * name and contact details with that one company. "Don't contact me again"
 * blocks the company from finding or contacting them.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorState } from '@/components/ui';
import { REQUEST_STATUS_LABEL, RateUnit, RequestStatus, WORK_TYPE_LABEL, WorkType, formatRate } from '@/lib/staffing';

interface StaffingRequest {
  id: string;
  orgName: string;
  roleTitle: string;
  summary: string;
  workType: WorkType;
  rateMinInr: number | null;
  rateMaxInr: number | null;
  rateUnit: RateUnit | null;
  location: string | null;
  remote: boolean;
  clientName: string | null;
  clientIndustry: string | null;
  status: RequestStatus;
  candidateMessage: string | null;
  createdAt: string;
  expiresAt: string;
}

function hoursLeft(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
}

export default function StaffingRequestsInbox() {
  const [items, setItems] = useState<StaffingRequest[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [conditionsFor, setConditionsFor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [block, setBlock] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api<StaffingRequest[]>('/staffing/me/requests').then(setItems).catch(() => setItems([]));
  }, []);

  async function respond(r: StaffingRequest, response: 'AVAILABLE' | 'CONDITIONAL' | 'NOT_NOW') {
    setBusy(r.id);
    setError('');
    try {
      await api(`/staffing/me/requests/${r.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ response, message: response === 'CONDITIONAL' ? message : undefined, block: !!block[r.id] }),
      });
      setItems((list) =>
        (list ?? []).map((x) => (x.id === r.id ? { ...x, status: response, candidateMessage: response === 'CONDITIONAL' ? message : null } : x)),
      );
      setConditionsFor(null);
      setMessage('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!items || items.length === 0) return null;
  const open = items.filter((r) => r.status === 'PENDING');
  const past = items.filter((r) => r.status !== 'PENDING');

  return (
    <section className="staffing-inbox">
      <h2>Staffing availability requests</h2>
      <p className="meta">
        Verified staffing companies asking whether you&apos;re available for a client role. They see your name and contact
        details only if you say yes.
      </p>
      {error && <ErrorState message={error} />}

      {open.map((r) => {
        const rate = formatRate(r.rateMinInr, r.rateMaxInr, r.rateUnit);
        const client = r.clientName ?? (r.clientIndustry ? `A client in ${r.clientIndustry}` : 'Client not named yet');
        return (
          <div key={r.id} className="card staffing-request">
            <div className="row" style={{ margin: 0, justifyContent: 'space-between' }}>
              <strong>{r.roleTitle}</strong>
              <span className="meta">{hoursLeft(r.expiresAt)}h left to reply</span>
            </div>
            <div className="meta">From {r.orgName} · {client}</div>
            <p style={{ margin: '6px 0' }}>{r.summary}</p>
            <div className="staffing-facts">
              <span>{WORK_TYPE_LABEL[r.workType]}</span>
              {rate && <span>{rate}</span>}
              {(r.location || r.remote) && <span>{[r.location, r.remote ? 'remote OK' : null].filter(Boolean).join(' · ')}</span>}
            </div>

            {conditionsFor === r.id ? (
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor={`cond-${r.id}`}>Your conditions</label>
                <textarea
                  id={`cond-${r.id}`}
                  rows={3}
                  maxLength={500}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. Available from 15 Dec, minimum ₹9,000 per day, remote only"
                />
                <div className="row" style={{ margin: 0 }}>
                  <button onClick={() => respond(r, 'CONDITIONAL')} disabled={busy === r.id || !message.trim()}>
                    {busy === r.id ? 'Sending…' : 'Send — share my contact details'}
                  </button>
                  <button className="btn-secondary" onClick={() => setConditionsFor(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="row" style={{ margin: '8px 0 0', flexWrap: 'wrap' }}>
                <button onClick={() => respond(r, 'AVAILABLE')} disabled={busy === r.id}>I&apos;m available</button>
                <button className="btn-secondary" onClick={() => setConditionsFor(r.id)} disabled={busy === r.id}>
                  Interested, with conditions
                </button>
                <button className="btn-secondary" onClick={() => respond(r, 'NOT_NOW')} disabled={busy === r.id}>Not right now</button>
              </div>
            )}
            <label className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontWeight: 400 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={!!block[r.id]}
                onChange={(e) => setBlock({ ...block, [r.id]: e.target.checked })}
              />
              Don&apos;t let {r.orgName} contact me again
            </label>
          </div>
        );
      })}

      {past.length > 0 && (
        <details className="staffing-past">
          <summary>Earlier requests ({past.length})</summary>
          {past.map((r) => (
            <div key={r.id} className="row" style={{ margin: '6px 0', justifyContent: 'space-between' }}>
              <span>{r.roleTitle} · {r.orgName}</span>
              <span className="meta">{REQUEST_STATUS_LABEL[r.status]}</span>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
