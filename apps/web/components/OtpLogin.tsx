'use client';

/**
 * Candidate signup/login: choose EMAIL or PHONE, receive a 6-digit OTP, get a
 * JWT — plus Google/GitHub as alternate sign-in methods that also provision a
 * new account on first use (see AuthService.loginWithIdentity — unlike the
 * employer portal there's no "existing account only" restriction here, so
 * OAuth stays an equal signup path, not just a login one).
 *
 *  - Email posts to /auth/email/otp/request + /auth/email/otp/verify
 *    (AuthService.requestCandidateEmailOtp, delivered via Resend).
 *  - Phone posts to /auth/otp/request + /auth/otp/verify
 *    (AuthService.requestOtp, delivered via MSG91 in production, logged in dev).
 *
 * Phone and email are separate identity keys on User. A candidate who signs
 * up one way and later wants the other should ADD it to the same account from
 * settings (POST /auth/link/phone|email/*) rather than signing up fresh, which
 * would create a second account — see /profile/account. The age/terms line
 * below the card (LegalAcceptanceNote) applies identically to both, and the
 * server records acceptance on every creation path (phone included).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, setTokens } from '@/lib/api';
import { startOAuthLogin } from '@/lib/oauth';
import Logo from './Logo';
import { GoogleIcon, GithubIcon } from './OAuthIcons';
import AuthMessageRotator from './AuthMessageRotator';
import LegalAcceptanceNote from './LegalAcceptanceNote';

/** Matches AuthService's RESEND_COOLDOWN_MS (60s) — purely a UX countdown; the server enforces the real limit regardless. */
const RESEND_COOLDOWN_SECONDS = 60;

type Method = 'email' | 'phone';

interface Props {
  onLoggedIn: () => void;
}

export default function OtpLogin({ onLoggedIn }: Props) {
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'input' | 'otp'>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [oauthError, setOauthError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const value = method === 'email' ? email : phone;
  const isEmail = method === 'email';

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  function switchMethod(next: Method) {
    if (next === method) return;
    setMethod(next);
    setStage('input');
    setOtp('');
    setError('');
    setResendIn(0);
  }

  function signInWith(provider: 'google' | 'github') {
    setOauthError('');
    try {
      startOAuthLogin(provider);
    } catch (e) {
      setOauthError((e as Error).message);
    }
  }

  /** Endpoint + payload key differ by method; everything else is shared. */
  function endpoints() {
    return isEmail
      ? { request: '/auth/email/otp/request', verify: '/auth/email/otp/verify', payload: (extra?: object) => ({ email: email.trim(), ...extra }) }
      : { request: '/auth/otp/request', verify: '/auth/otp/verify', payload: (extra?: object) => ({ phone: phone.trim(), ...extra }) };
  }

  async function sendCode() {
    setError('');
    setBusy(true);
    try {
      const ep = endpoints();
      await api(ep.request, { method: 'POST', body: JSON.stringify(ep.payload()) });
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
      const ep = endpoints();
      const res = await api<{ accessToken: string; refreshToken: string }>(ep.verify, {
        method: 'POST',
        body: JSON.stringify(ep.payload({ otp })),
      });
      setTokens(res.accessToken, res.refreshToken);
      onLoggedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function useAnotherValue() {
    setStage('input');
    setOtp('');
    setError('');
    setResendIn(0);
  }

  const canSend = value.trim().length > 0 && !busy;
  const canVerify = otp.length === 6 && !busy;

  return (
    <main className="auth-split">
      <div className="auth-split-visual">
        <AuthMessageRotator />
      </div>
      <div className="auth-split-panel">
        <h1 className="auth-split-headline">Global AI Talent Hub</h1>
        <div className="auth-split-card">
          <Link href="/" className="brand-lockup-hero brand-lockup-link" aria-label="Myambii home">
            <Logo className="brand-logo-hero" />
            <span className="brand-product-name">Myambii</span>
          </Link>
          <p className="auth-subtitle" style={{ marginBottom: 4 }}>
            Prove your AI skills, get matched to roles that want them.
          </p>
          <p className="meta" style={{ marginBottom: 18 }}>
            Sign in with your email or phone to get started.
          </p>

          {stage === 'input' && (
            <>
              <div className="auth-method-toggle" role="tablist" aria-label="Sign-in method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isEmail}
                  className={isEmail ? 'is-active' : ''}
                  onClick={() => switchMethod('email')}
                >
                  Email
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isEmail}
                  className={!isEmail ? 'is-active' : ''}
                  onClick={() => switchMethod('phone')}
                >
                  Phone
                </button>
              </div>

              <div className="field">
                {isEmail ? (
                  <>
                    <label htmlFor="identifier">Email</label>
                    <input
                      id="identifier"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSend) sendCode();
                      }}
                    />
                  </>
                ) : (
                  <>
                    <label htmlFor="identifier">Phone number</label>
                    <input
                      id="identifier"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSend) sendCode();
                      }}
                    />
                  </>
                )}
                <button style={{ width: '100%', marginTop: 10 }} onClick={sendCode} disabled={!canSend}>
                  {busy ? 'Sending code…' : 'Send code'}
                </button>
              </div>
            </>
          )}

          {stage === 'otp' && (
            <>
              <p className="meta">
                We sent a 6-digit code to <strong>{value.trim()}</strong>. Enter it below to continue.
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
                <button type="button" className="btn-link" onClick={useAnotherValue} disabled={busy}>
                  {isEmail ? 'Use a different email' : 'Use a different number'}
                </button>
                <button type="button" className="btn-link" onClick={sendCode} disabled={busy || resendIn > 0}>
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}

          {error && <p className="error">{error}</p>}

          <div
            className="auth-divider-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              margin: '20px 0',
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
        <LegalAcceptanceNote />
      </div>
    </main>
  );
}
