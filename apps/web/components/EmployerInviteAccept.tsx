'use client';

/**
 * Team-invite acceptance: enter the invited email → verify via email OTP →
 * signed in as an EMPLOYER_MEMBER of the inviting org. Mirrors
 * EmployerOtpLogin's two-stage email/OTP shape, minus orgName — the org
 * comes from the pending OrgInvitation row server-side
 * (AuthService.requestInviteOtp/acceptInvite), not from anything entered
 * here. Deliberately outside the app/employer/* route tree (this page
 * lives at /employer-invite) so it never hits app/employer/layout.tsx's
 * "redirect to /employer if not logged in" gate — an invitee is by
 * definition not logged in yet.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import Logo from './Logo';

const { api, setTokens } = employerApi;

/** Matches AuthService's RESEND_COOLDOWN_MS (60s) — purely a UX countdown; the server enforces the real limit regardless. */
const RESEND_COOLDOWN_SECONDS = 60;

interface Props {
  initialEmail: string;
}

export default function EmployerInviteAccept({ initialEmail }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'email' | 'otp'>('email');
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
      await api('/auth/employer/invite/otp/request', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
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
      const res = await api<{ accessToken: string; refreshToken: string }>('/auth/employer/invite/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), otp }),
      });
      setTokens(res.accessToken, res.refreshToken);
      router.replace('/employer/dashboard');
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
      <h1 className="auth-headline">You&apos;ve been invited</h1>
      <div className="auth-card">
        <div className="brand-lockup-hero">
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">
            SkillProof <span style={{ color: 'var(--auth-text-secondary)', fontWeight: 500 }}>for Employers</span>
          </span>
        </div>
        <p className="auth-subtitle" style={{ marginBottom: 4 }}>
          Join your team on SkillProof.
        </p>
        <p className="meta" style={{ marginBottom: 20 }}>
          Confirm the email your invitation was sent to, and we&apos;ll send a code to verify it&apos;s you.
        </p>

        {stage === 'email' && (
          <>
            <div className="field">
              <label htmlFor="email">Invited email</label>
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
              {busy ? 'Verifying…' : 'Verify and join'}
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
    </main>
  );
}
