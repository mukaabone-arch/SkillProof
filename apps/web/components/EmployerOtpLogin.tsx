'use client';

/**
 * Employer sign-in AND signup, both through the same work email → email OTP
 * → JWT flow — this screen doesn't ask which one you're doing, because it
 * can't know until the OTP is verified. Organization name is collected
 * up front but is genuinely optional: it's only used the first time a given
 * email verifies (see below), so a returning employer can leave it blank.
 * Employer accounts have no viable phone path today — apps/api's
 * AuthService.requestOtp (SMS) just logs a "production send not
 * implemented yet" warning and delivers nothing, so phone-OTP signup is
 * currently a dead end for every employer. This posts to the email variant
 * of the same flow instead — /auth/employer/otp/request and
 * /auth/employer/otp/verify — which actually sends via Resend (see
 * AuthService.requestEmailOtp/sendOtpEmail) and, on a brand-new email,
 * provisions an EMPLOYER_ADMIN user + Organization exactly like the phone
 * path used to. A returning email just logs in; the org name is ignored
 * once the account already exists (see AuthService.verifyEmailOtp) — so
 * this screen's own validation only requires an email, never the org name.
 *
 * Email OTP is the *only* employer login path, deliberately — no OAuth
 * option is offered here at all (contrast the candidate login, OtpLogin.tsx,
 * which does offer Google). Employer signup requires a company email domain
 * (COMPANY_EMAIL_REQUIRED — see employer-email-domain.ts), and an OAuth
 * button would let someone sign in with whatever personal address their
 * Google/GitHub account happens to use, bypassing that check entirely.
 * /auth/employer/google was removed outright (not just hidden) for the
 * same reason; /auth/employer/github still exists (GitHub already never
 * had a button here) but is likewise not linked to from this screen.
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';
import BrandLockup from './BrandLockup';
import AuthMessageRotator, { type AuthMessage } from './AuthMessageRotator';
import LegalAcceptanceNote from './LegalAcceptanceNote';

const { api, setTokens } = employerApi;

/** Matches AuthService's RESEND_COOLDOWN_MS (60s) — purely a UX countdown; the server enforces the real limit regardless. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Employer-facing value props — see AuthMessageRotator's own doc comment for why this is a prop rather than a fork. */
const EMPLOYER_MESSAGES: AuthMessage[] = [
  {
    headline: 'Hire on evidence, not claims',
    support: "Every badge is earned through a real assessment. Conversation-based assessments are reviewed by a person before the badge is issued.",
  },
  {
    headline: 'Screen your shortlist in days, not weeks',
    support: 'Send any candidate a verified assessment and get reviewed evidence back — no scheduling, no panel time.',
  },
  {
    headline: 'See who can actually do the work',
    support: "Verified skills and levels on every profile, so you're comparing ability rather than CV keywords.",
  },
  {
    headline: 'One place from shortlist to hire',
    support: 'Invite, interview, offer and track — every stage visible to both sides, nothing lost in inboxes.',
  },
];

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
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

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

  // orgName is only used the first time a new email verifies (see this
  // file's own doc comment) — a returning employer must be able to leave it
  // blank, so it's excluded here entirely. A *supplied* name still has to
  // clear the same minimum length the backend expects, so a stray
  // single-character value can't slip through as a real org name.
  const orgNameValid = orgName.trim().length === 0 || orgName.trim().length >= 2;
  const canSend = orgNameValid && email.trim().length > 0 && !busy;
  const canVerify = otp.length === 6 && !busy;

  return (
    <main className="auth-split">
      <div className="auth-split-visual">
        <AuthMessageRotator messages={EMPLOYER_MESSAGES} />
      </div>
      <div className="auth-split-panel">
        <h1 className="auth-split-headline">Global AI Talent Hub</h1>
        <div className="auth-split-card">
          <BrandLockup variant="hero" href="/" ariaLabel="MyAmbii home" suffix="Employers" />
          <p className="auth-subtitle" style={{ marginBottom: 4 }}>
            Hire on proven skills, not keywords.
          </p>
          <p className="meta" style={{ marginBottom: 20 }}>
            Sign in or sign up with your work email to get started.
          </p>

          {stage === 'details' && (
            <>
              <div className="field">
                <label htmlFor="orgName">Organization name (optional)</label>
                <input
                  id="orgName"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Inc."
                  maxLength={160}
                />
                <p className="meta" style={{ margin: 0 }}>
                  Only needed when creating a new organisation — returning employers can leave this blank.
                </p>
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
        </div>
        <LegalAcceptanceNote />
      </div>
    </main>
  );
}
