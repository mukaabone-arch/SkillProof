'use client';

/**
 * "Submit to a client" on an accepted availability request (staffing portal).
 * Creates a submission that waits for the candidate's approval — they see
 * the client's name before agreeing (POST /staffing/submissions).
 */
import { useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

interface Client { id: string; name: string }

export default function StaffingSubmitToClient({ candidateId, defaultRole }: { candidateId: string; defaultRole: string }) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientId, setClientId] = useState('');
  const [role, setRole] = useState(defaultRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function start() {
    setOpen(true);
    setError('');
    if (!clients) {
      try {
        const list = await api<Client[]>('/staffing/clients');
        setClients(list);
        if (list.length === 1) setClientId(list[0].id);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api('/staffing/submissions', { method: 'POST', body: JSON.stringify({ candidateId, clientId, roleTitle: role }) });
      setSent(true);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="meta" style={{ margin: '8px 0 0' }}>
        Sent for the candidate&apos;s approval — track it in <Link href="/employer/submissions">Submissions</Link>.
      </p>
    );
  }
  if (!open) {
    return (
      <div className="row" style={{ margin: '8px 0 0' }}>
        <button type="button" onClick={start}>Submit to a client</button>
      </div>
    );
  }
  return (
    <div className="staffing-request-form">
      {clients && clients.length === 0 ? (
        <p className="meta" style={{ margin: 0 }}>
          Add a client first in <Link href="/employer/clients">Clients</Link>.
        </p>
      ) : (
        <>
          <div className="staffing-rate">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
              <option value="">Choose a client…</option>
              {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={role} maxLength={120} onChange={(e) => setRole(e.target.value)} placeholder="Role at the client" aria-label="Role" />
          </div>
          <p className="meta" style={{ margin: 0 }}>
            The candidate sees the client&apos;s name and must approve within 72 hours. Once approved, you represent them
            to this client and no other recruiter can submit them there.
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ margin: 0 }}>
        <button onClick={submit} disabled={busy || !clientId || !role.trim()}>{busy ? 'Sending…' : 'Ask candidate to approve'}</button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
