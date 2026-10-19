'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { addPasskey, guessDeviceName, passkeysSupported } from '@/lib/passkeys';

type Passkey = { id: string; name: string | null; createdAt: string; lastUsedAt: string | null; backedUp: boolean };

const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function PasskeysSection() {
  const [items, setItems] = useState<Passkey[] | null>(null);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      setItems(await api<Passkey[]>('/auth/passkeys'));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    setSupported(passkeysSupported());
    load();
  }, []);

  async function add() {
    setError('');
    setBusy(true);
    try {
      if (await addPasskey(guessDeviceName())) await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Passkey) {
    if (!window.confirm(`Remove the passkey "${p.name ?? 'Passkey'}"? You won't be able to sign in with it anymore.`)) return;
    setError('');
    try {
      await api(`/auth/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2>Passkeys</h2>
      <p className="meta">
        Sign in with your fingerprint, face, or device PIN instead of a code. Passkeys sync across your devices
        through iCloud Keychain or Google Password Manager.
      </p>

      {items && items.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0' }}>
          {items.map((p) => (
            <li
              key={p.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--ink-12)' }}
            >
              <div>
                <strong>{p.name ?? 'Passkey'}</strong>
                <div className="meta">
                  Added {fmt(p.createdAt)}
                  {p.lastUsedAt ? ` · Last used ${fmt(p.lastUsedAt)}` : ' · Not used yet'}
                </div>
              </div>
              <button type="button" className="btn-link" onClick={() => remove(p)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported ? (
        <button type="button" className="btn btn-secondary" onClick={add} disabled={busy}>
          {busy ? 'Waiting for your device…' : 'Add a passkey'}
        </button>
      ) : (
        <p className="meta">This browser doesn't support passkeys.</p>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
