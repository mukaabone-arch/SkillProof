'use client';

/**
 * Employer signup: Organization name + work email → email OTP → JWT.
 * Employer accounts have no viable phone path today — apps/api's
 * AuthService.requestOtp (SMS) just logs a "production send not
 * implemented yet" warning and delivers nothing, so phone-OTP signup is
 * currently a dead end for every employer. This posts to the email variant
 * of the same flow instead — /auth/employer/otp/request and
 * /auth/employer/otp/verify — which actually sends via Resend (see
 * AuthService.requestEmailOtp/sendOtpEmail) and, on a brand-new email,
 * provisions an EMPLOYER_ADMIN user + Organization exactly like the phone
 * path used to. A returning email just logs in; the org name is ignored
 * once the account already exists (see AuthService.verifyEmailOtp).
 *
 * The Google/GitHub buttons below are NOT a signup path: /auth/employer/:provider
 * only resolves an *existing* employer account (see
 * AuthService.loginEmployerWithIdentity) and never provisions a new org —
 * anyone without one already gets bounced back here with an error. So
 * they're framed under "Already have an account?", separated from the
 * primary signup form above, rather than presented as an equal alternative
 * a first-time employer might reasonably pick and get rejected by.
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';
import { startOAuthLogin } from '@/lib/oauth';
import Logo from './Logo';
import { GoogleIcon, GithubIcon } from './OAuthIcons';

const { api, setTokens } = employerApi;

/** Matches AuthService's RESEND_COOLDOWN_MS (60s) — purely a UX countdown; the server enforces the real limit regardless. */
const RESEND_COOLDOWN_SECONDS = 60;

interface Props {
  onLoggedIn: () => void;
}

export default function EmployerOtpLogin({ onLoggedIn }: Props) {
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'details' | 'otp'>('details');
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
      startOAuthLogin(provider, 'employer');
    } catch (e) {
      setOauthError((e as Error).message);
    }
  }

  async function sendCode() {
    setError('');
    setBusy(true);
    try {
      await api('/auth/employer/otp/request', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
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
      const res = await api<{ accessToken: string; refreshToken: string }>('/auth/employer/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), otp, orgName: orgName.trim() }),
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
    setStage('details');
    setOtp('');
    setError('');
    setResendIn(0);
  }

  const canSend = orgName.trim().length >= 2 && email.trim().length > 0 && !busy;
  const canVerify = otp.length === 6 && !busy;

  return (
    <main className="auth">
      <h1 className="auth-headline">Global AI Talent Hub</h1>
      <div className="auth-card">
        <div className="brand-lockup-hero">
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">
            SkillProof <span style={{ color: 'var(--ink-60)', fontWeight: 500 }}>for Employers</span>
          </span>
        </div>
        <p>Post assessments and find verified candidates. Sign up with your work email to get started.</p>

        {stage === 'details' && (
          <>
            <div className="field">
              <label htmlFor="orgName">Organization name</label>
              <input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Inc."
                maxLength={160}
              />
            </div>
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSend) sendCode();
                }}
              />
            </div>
            <button style={{ width: '100%' }} onClick={sendCode} disabled={!canSend}>
              {busy ? 'Sending code…' : 'Send code'}
            </button>
          </>
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
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            margin: '24px 0 14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              color: 'var(--ink-30)',
              fontSize: '0.8rem',
            }}
          >
            <span style={{ flex: 1, height: 1, background: 'var(--ink-12)' }} />
            Already have an account?
            <span style={{ flex: 1, height: 1, background: 'var(--ink-12)' }} />
          </div>
          <p className="meta" style={{ margin: 0, textAlign: 'center' }}>
            Sign in below if your organization is already set up on SkillProof.
          </p>
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
