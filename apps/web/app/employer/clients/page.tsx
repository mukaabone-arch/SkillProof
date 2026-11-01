'use client';

/**
 * Staffing portal: Clients — the companies this staffing company places
 * candidates with. A client's name and website are how MyAmbii recognises
 * the same client across staffing companies (no double submission), so add
 * the website when you know it.
 */
import { FormEvent, useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

interface Client { id: string; name: string; industry: string | null; website: string | null; archivedAt: string | null }

export default function StaffingClientsPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({ name: '', industry: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load(archived = showArchived) {
    try {
      setClients(await api<Client[]>(`/staffing/clients${archived ? '?archived=true' : ''}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load(showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/staffing/clients', {
        method: 'POST',
        body: JSON.stringify({ name: form.name, industry: form.industry || undefined, website: form.website || undefined }),
      });
      setForm({ name: '', industry: '', website: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(c: Client, archived: boolean) {
    setError('');
    try {
      await api(`/staffing/clients/${c.id}`, { method: 'PATCH', body: JSON.stringify({ archived }) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="container-wide">
      <h1>Clients</h1>
      <p>
        The companies you place candidates with. Add the website where you can — it&apos;s how MyAmbii recognises the same
        client across staffing companies, so a candidate is never submitted to one client twice.
      </p>

      <form className="card staffing-filters" onSubmit={add}>
        <div className="field">
          <label htmlFor="c-name">Client name</label>
          <input id="c-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="c-industry">Industry (optional)</label>
          <input id="c-industry" maxLength={120} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="c-web">Website (optional)</label>
          <input id="c-web" maxLength={255} placeholder="acme.com" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        </div>
        <div className="field staffing-filters-go">
          <button type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Adding…' : 'Add client'}</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      <label className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived clients
      </label>

      {clients?.length === 0 && <p className="meta">No clients yet.</p>}
      {clients?.map((c) => (
        <div key={c.id} className="card staffing-talent">
          <div className="row" style={{ margin: 0, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <strong>{c.name}{c.archivedAt ? ' (archived)' : ''}</strong>
            <button type="button" className="btn-secondary" onClick={() => setArchived(c, !c.archivedAt)}>
              {c.archivedAt ? 'Restore' : 'Archive'}
            </button>
          </div>
          <div className="meta">{[c.industry, c.website].filter(Boolean).join(' · ') || 'No industry or website yet'}</div>
        </div>
      ))}
    </main>
  );
}
