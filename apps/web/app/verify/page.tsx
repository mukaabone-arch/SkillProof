'use client';

/**
 * Hard gate screen for a candidate missing either a verified phone or a
 * verified email — see apps/api's CandidateVerificationGuard /
 * candidate-verification-readiness.ts, which is what actually redirects
 * here (via lib/candidateVerification.tsx's CandidateVerificationProvider,
 * mounted at the app root). Modeled directly on ReactivatePrompt: a
 * locked-state screen with its own logout button, not relying on
 * CandidateNav being present.
 *
 * Copy is deliberately explicit about *why* this exists, especially for
 * Google/GitHub sign-ins — OAuth only ever supplies a verified email, never
 * a phone (see AuthService.createUserWithIdentity/loginWithIdentity), so
 * every OAuth candidate lands here needing to add a phone, and the screen
 * must read as "here's what we need and why," not an arbitrary obstacle.
 *
 * Reuses the exact request/verify/resend OTP interaction OtpLogin already
 * uses for signup, just pointed at the link/* endpoints (POST
 * /auth/link/phone/request|verify or /auth/link/email/request|verify)
 * instead of signup's otp/request|verify — those are how a candidate who
 * signed up one way attaches the other channel to the SAME account (see
 * AuthService.requestLinkPhoneOtp/requestLinkEmailOtp's own doc comment).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, logout, type ApiError } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useCandidateVerification } from '@/lib/candidateVerification';
import { useEntitlements } from '@/lib/entitlements';

interface Me {
  role: string;
  phone: string | null;
  email: string | null;
}

type Channel = 'phone' | 'email';

/** Matches OtpLogin's own resend cooldown (AuthService's RESEND_COOLDOWN_MS) — purely a UX countdown. */
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyPage() {
  const ready = useRequireAuth();
  const router = useRouter();
  const { refetch } = useCandidateVerification();
  const { refetch: refetchEntitlements } = useEntitlements();

  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState('');

  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [value, setValue] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'input' | 'otp'>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(() => {
    api<Me>('/users/me')
      .then((data) => {
        setMe(data);
        // Already complete (finished in another tab, or a stale redirect) — no reason to sit here.
        if (data.phone && data.email) router.replace('/candidate');
      })
      .catch((e) => setLoadError((e as ApiError).message));
  }, [router]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  function startChannel(channel: Channel) {
    setActiveChannel(channel);
    setValue('');
    setOtp('');
    setStage('input');
    setError('');
    setResendIn(0);
  }

  /** Endpoint + payload key differ by channel; everything else (request/verify/resend) is shared — same split as OtpLogin's own endpoints(). */
  function endpoints(channel: Channel) {
    return channel === 'email'
      ? {
          request: '/auth/link/email/request',
          verify: '/auth/link/email/verify',
          payload: (extra?: object) => ({ email: value.trim(), ...extra }),
        }
      : {
          request: '/auth/link/phone/request',
          verify: '/auth/link/phone/verify',
          payload: (extra?: object) => ({ phone: value.trim(), ...extra }),
        };
  }

  async function sendCode() {
    if (!activeChannel) return;
    setError('');
    setBusy(true);
    try {
      const ep = endpoints(activeChannel);
      await api(ep.request, { method: 'POST', body: JSON.stringify(ep.payload()) });
      setStage('otp');
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!activeChannel) return;
    setError('');
    setBusy(true);
    try {
      const ep = endpoints(activeChannel);
      await api(ep.verify, { method: 'POST', body: JSON.stringify(ep.payload({ otp })) });
      // Refresh both the gate's cached status and entitlements BEFORE
      // navigating away — otherwise CandidateVerificationProvider still
      // thinks this token is incomplete and immediately bounces back here,
      // and the dashboard's first render would briefly show a stale
      // (pre-verification) entitlements snapshot.
      await Promise.all([refetch(), refetchEntitlements()]);
      router.replace('/candidate');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    router.replace('/candidate');
  }

  if (!ready) return null;

  const canSend = value.trim().length > 0 && !busy;
  const canVerify = otp.length === 6 && !busy;

  return (
    <main className="auth auth-gradient">
      <h1 className="auth-headline">One more step</h1>
      <div className="auth-card">
        <h2 style={{ marginTop: 0 }}>Verify your contact details</h2>
        <p>
          Every MyAmbii candidate account needs a verified phone number <em>and</em> a verified email address —
          it&apos;s how employers and our support team can reach you, and it&apos;s your only recovery path if you
          ever lose access to one of them.
        </p>
        <p>
          If you signed up with Google or GitHub, that only ever gives us a verified email — those sign-in methods
          never share a phone number. You&apos;ll need to add and verify one below to continue; it&apos;s a one-time
          step, not something specific to your account.
        </p>

        {loadError && <p className="error">{loadError}</p>}

        {me && (
          <>
            <ul style={{ paddingLeft: 20, margin: '0 0 16px' }}>
              <li>Phone: {me.phone ? <strong>{me.phone}</strong> : 'Not added yet'}</li>
              <li>Email: {me.email ? <strong>{me.email}</strong> : 'Not added yet'}</li>
            </ul>

            {!activeChannel && (
              <div className="row" style={{ margin: 0 }}>
                {!me.phone && <button onClick={() => startChannel('phone')}>Add phone number</button>}
                {!me.email && <button onClick={() => startChannel('email')}>Add email address</button>}
              </div>
            )}

            {activeChannel && stage === 'input' && (
              <div className="field">
                <label htmlFor="channelValue">{activeChannel === 'email' ? 'Email' : 'Phone number'}</label>
                <input
                  id="channelValue"
                  type={activeChannel === 'email' ? 'email' : 'tel'}
                  inputMode={activeChannel === 'email' ? 'email' : 'tel'}
                  autoComplete={activeChannel === 'email' ? 'email' : 'tel'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={activeChannel === 'email' ? 'you@example.com' : '+91 98765 43210'}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSend) sendCode();
                  }}
                />
                <div className="row" style={{ margin: '10px 0 0' }}>
                  <button onClick={sendCode} disabled={!canSend}>
                    {busy ? 'Sending code…' : 'Send code'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setActiveChannel(null)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {activeChannel && stage === 'otp' && (
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
                  <button type="button" className="btn-link" onClick={() => setStage('input')} disabled={busy}>
                    {activeChannel === 'email' ? 'Use a different email' : 'Use a different number'}
                  </button>
                  <button type="button" className="btn-link" onClick={sendCode} disabled={busy || resendIn > 0}>
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                  </button>
                </div>
              </>
            )}

            {error && <p className="error">{error}</p>}
          </>
        )}

        <div className="row" style={{ margin: '20px 0 0' }}>
          <button type="button" className="btn-secondary" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      </div>
    </main>
  );
}
