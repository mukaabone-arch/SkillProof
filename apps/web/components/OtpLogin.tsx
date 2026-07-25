'use client';

/**
 * Candidate signup/login: email → email OTP → JWT, plus Google/GitHub as
 * alternate sign-in methods that also provision a new account on first use
 * (see AuthService.loginWithIdentity — unlike the employer portal, there's
 * no "existing account only" restriction here, so OAuth stays an equal
 * signup path, not just a login one).
 *
 * Email is the primary path because phone-OTP delivery is unimplemented in
 * production (AuthService.requestOtp just logs a "pending" warning and
 * sends nothing — see its class doc), so it was a dead end for anyone
 * without the dev-only fixed code. This posts to /auth/email/otp/request
 * and /auth/email/otp/verify, which actually deliver via Resend (see
 * AuthService.requestCandidateEmailOtp/sendCandidateOtpEmail) and, on a
 * brand-new email, provision a CANDIDATE with an empty profile — mirrors
 * apps/web's EmployerOtpLogin.tsx, minus the org-name field and the
 * "Already have an account?" OAuth framing (not needed here, since OAuth
 * still self-provisions for candidates).
 */
import { useEffect, useState } from 'react';
import { api, setTokens } from '@/lib/api';
import { startOAuthLogin } from '@/lib/oauth';
import Logo from './Logo';
import { GoogleIcon, GithubIcon } from './OAuthIcons';

/** Matches AuthService's RESEND_COOLDOWN_MS (60s) — purely a UX countdown; the server enforces the real limit regardless. */
const RESEND_COOLDOWN_SECONDS = 60;

interface Props {
  onLoggedIn: () => void;
}

export default function OtpLogin({ onLoggedIn }: Props) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'email' | 'otp'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [oauthError, setOauthError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  function signInWith(provider: 'google' | 'github') {
    setOauthError('');
    try {
      startOAuthLogin(provider);
    } catch (e) {
      setOauthError((e as Error).message);
    }
  }

  async function sendCode() {
    setError('');
    setBusy(true);
    try {
      await api('/auth/email/otp/request', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      setStage('otp');
      setResendIn(RESEND_COOLDOWN_SECONDS);
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
      const res = await api<{ accessToken: string; refreshToken: string }>('/auth/email/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), otp }),
      });
      setTokens(res.accessToken, res.refreshToken);
      onLoggedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function useAnotherEmail() {
    setStage('email');
    setOtp('');
    setError('');
    setResendIn(0);
  }

  const canSend = email.trim().length > 0 && !busy;
  const canVerify = otp.length === 6 && !busy;

  return (
    <main className="auth auth-gradient">
      <h1 className="auth-headline">Global AI Talent Hub</h1>
      <div className="auth-card">
        <div className="brand-lockup-hero">
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">SkillProof</span>
        </div>
        <p>Verified AI-skill assessments. Sign in with your email to get started.</p>

        {stage === 'email' && (
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSend) sendCode();
              }}
            />
            <button style={{ width: '100%', marginTop: 10 }} onClick={sendCode} disabled={!canSend}>
              {busy ? 'Sending code…' : 'Send code'}
            </button>
          </div>
        )}

        {stage === 'otp' && (
          <>
            <p className="meta">
              We sent a 6-digit code to <strong>{email}</strong>. Enter it below to continue.
            </p>
            <div className="field">
              <label htmlFor="otp">Verification code</label>
              <input
                id="otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canVerify) verify();
                }}
              />
            </div>
            <button style={{ width: '100%' }} onClick={verify} disabled={!canVerify}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <button type="button" className="btn-link" onClick={useAnotherEmail} disabled={busy}>
                Use a different email
              </button>
              <button type="button" className="btn-link" onClick={sendCode} disabled={busy || resendIn > 0}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </>
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
