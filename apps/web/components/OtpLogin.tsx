'use client';

/** Phone → OTP → JWT login flow. In dev, the OTP is always 123456. */
import { useState } from 'react';
import { api, setTokens } from '@/lib/api';
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
      <h1 className="auth-headline">
        The Global Intelligence Network
        <br />
        for Verified AI Talent.
      </h1>
      <div className="auth-card">
        <div className="brand-lockup-hero">
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">SkillProof</span>
        </div>
        <p>Verified AI-skill assessments. Log in with your phone to get started.</p>

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
      </div>
    </main>
  );
}
