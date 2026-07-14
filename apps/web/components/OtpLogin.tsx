'use client';

/** Phone → OTP → JWT login flow, plus Google/GitHub as alternate sign-in methods. In dev, the OTP is always 123456. */
import { useState } from 'react';
import { api, setTokens } from '@/lib/api';
import { startOAuthLogin } from '@/lib/oauth';
import Logo from './Logo';
import { GoogleIcon, GithubIcon } from './OAuthIcons';

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
