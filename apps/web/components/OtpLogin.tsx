'use client';

/** Phone → OTP → JWT login flow, plus Google/GitHub as alternate sign-in methods. In dev, the OTP is always 123456. */
import { useState } from 'react';
import { api, setTokens } from '@/lib/api';
import { startOAuthLogin } from '@/lib/oauth';
import Logo from './Logo';

interface Props {
  onLoggedIn: () => void;
}

export default function OtpLogin({ onLoggedIn }: Props) {
  const [phone, setPhone] = useState('+919999999999');
  const [otp, setOtp] = useState('123456');
  const [stage, setStage] = useState<'phone' | 'otp'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [oauthError, setOauthError] = useState('');

  function signInWith(provider: 'google' | 'github') {
    setOauthError('');
    try {
      startOAuthLogin(provider);
    } catch (e) {
      setOauthError((e as Error).message);
    }
  }

  async function requestOtp() {
    setError('');
    setBusy(true);
    try {
      await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });
      setStage('otp');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError('');
    setBusy(true);
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, otp }),
      });
      setTokens(res.accessToken, res.refreshToken);
      onLoggedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <h1 className="auth-headline">Global AI Talent Hub</h1>
      <div className="auth-card">
        <div className="brand-lockup-hero">
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">SkillProof</span>
        </div>
        <p>Verified AI-skill assessments. Sign in to get started.</p>

        {stage === 'phone' && (
          <div className="row">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91..." />
            <button onClick={requestOtp} disabled={busy}>Send OTP</button>
          </div>
        )}

        {stage === 'otp' && (
          <div className="row">
            <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit OTP" />
            <button onClick={verify} disabled={busy}>Verify</button>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            margin: '20px 0',
            color: 'var(--ink-30)',
            fontSize: '0.8rem',
          }}
        >
          <span style={{ flex: 1, height: 1, background: 'var(--ink-12)' }} />
          or continue with
          <span style={{ flex: 1, height: 1, background: 'var(--ink-12)' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => signInWith('google')}
          >
            <GoogleIcon /> Sign in with Google
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => signInWith('github')}
          >
            <GithubIcon /> Sign in with GitHub
          </button>
        </div>

        {oauthError && <p className="error">{oauthError}</p>}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
