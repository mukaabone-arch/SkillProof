'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { addPasskey, apiFor, guessDeviceName, passkeysSupported, type Portal } from '@/lib/passkeys';

type Passkey = { id: string; name: string | null; createdAt: string; lastUsedAt: string | null; backedUp: boolean };

const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function PasskeysSection({ portal = 'candidate' }: { portal?: Portal }) {
  const api = apiFor(portal);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    setError('');
    setBusy(true);
    try {
      if (await addPasskey(guessDeviceName(), portal)) await load();
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
    <Card style={{ marginBottom: 32 }}>
      {/* One wrapper so Card's own layout treats this as a single block and everything stacks vertically. */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Passkeys</h2>
          <p className="meta" style={{ margin: 0 }}>
            Sign in with your fingerprint, face, or device PIN instead of a code. Passkeys sync across your devices
            through iCloud Keychain or Google Password Manager.
          </p>
        </div>

        {items && items.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items.map((p) => (
              <li
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  padding: '12px 0',
                  borderTop: '1px solid var(--ink-12)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <strong>{p.name ?? 'Passkey'}</strong>
                  <div className="meta" style={{ marginTop: 2 }}>
                    Added {fmt(p.createdAt)}
                    {' · '}
                    {p.lastUsedAt ? `Last used ${fmt(p.lastUsedAt)}` : 'Not used yet'}
                  </div>
                </div>
                <button type="button" className="btn-link" style={{ flexShrink: 0 }} onClick={() => remove(p)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div>
          {supported ? (
            <button type="button" className="btn btn-secondary" onClick={add} disabled={busy}>
              {busy ? 'Waiting for your device…' : 'Add a passkey'}
            </button>
          ) : (
            <p className="meta" style={{ margin: 0 }}>
              This browser doesn&apos;t support passkeys.
            </p>
          )}
        </div>

        {error && (
          <p className="error" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
