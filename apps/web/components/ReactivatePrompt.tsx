'use client';

/**
 * Shown instead of the dashboard when a signed-in candidate's account is
 * deactivated — explicit reactivation, never silent restoration (per the
 * product requirement this exists for). "Not now" signs back out rather
 * than dropping into a normal session anyway: a deactivated profile is
 * still hidden from search/matching either way, so there's nothing a
 * dashboard would usefully show without reactivating first.
 */
import { useState } from 'react';
import { api, logout, type ApiError } from '@/lib/api';

interface Props {
  onReactivated: () => void;
  onDeclined: () => void;
}

export default function ReactivatePrompt({ onReactivated, onDeclined }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reactivate() {
    setBusy(true);
    setError('');
    try {
      await api('/account/reactivate', { method: 'POST' });
      onReactivated();
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    await logout();
    onDeclined();
  }

  return (
    <main className="auth auth-gradient">
      <h1 className="auth-headline">Welcome back</h1>
      <div className="auth-card">
        <h2 style={{ marginTop: 0 }}>Reactivate your account?</h2>
        <p>
          Your account is currently deactivated — your profile is hidden from employer search and matching, and
          you&apos;re not receiving notification emails. Reactivating restores all of that immediately. Nothing was
          lost while you were away.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ margin: 0 }}>
          <button onClick={reactivate} disabled={busy}>
            {busy ? 'Working…' : 'Reactivate my account'}
          </button>
          <button type="button" className="btn-secondary" onClick={decline} disabled={busy}>
            Not now
          </button>
        </div>
      </div>
    </main>
  );
}
