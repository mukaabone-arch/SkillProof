'use client';

/**
 * Candidate home: OTP login for anonymous visitors, dashboard once
 * authenticated. PLATFORM_ADMIN accounts share this same OTP login (see
 * prisma/make-admin.ts — admin is just a role flip on an ordinary user), so
 * once logged in we check the role and bounce admins straight to the admin
 * console rather than rendering the candidate dashboard for them.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, logout } from '@/lib/api';
import OtpLogin from '@/components/OtpLogin';
import Dashboard from '@/components/Dashboard';
import ReactivatePrompt from '@/components/ReactivatePrompt';

interface Me {
  role: string;
  phone: string | null;
  email: string | null;
}
interface AccountStatus {
  deactivated: boolean;
}

/**
 * Bounded window after this page has requested a client-side redirect
 * (to /admin or /verify) before it stops trusting the navigation to
 * complete on its own and offers a way out instead — same reasoning and
 * value as lib/candidateVerification.tsx's REDIRECT_FALLBACK_MS. Without
 * this, a redirect that never visibly completes (a router bug, a stalled
 * chunk load) would leave a signed-in candidate on a bare "Loading…" with
 * no escape — the exact failure mode Bug #2 already ruled out for the
 * global gate's own placeholder.
 */
const REDIRECT_FALLBACK_MS = 4000;

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'anon' | 'authed' | 'deactivated' | 'redirecting'>('loading');

  const resolveRole = useCallback(async () => {
    setStatus('loading');
    try {
      const me = await api<Me>('/users/me');
      if (me.role === 'PLATFORM_ADMIN') {
        setStatus('redirecting');
        router.replace('/admin/assessments');
        return;
      }
      // Resolved here, before Dashboard (or the 6 protected candidate
      // endpoints it fires) is ever rendered — this runs both on a fresh
      // page load and on every client-side login, since OtpLogin/OAuth
      // call resolveRole directly rather than relying on an effect
      // dependency to notice the token appeared. That's what closes the gap
      // where a client-side anonymous->authenticated transition used to
      // race Dashboard's own fetches against the (indirect) global gate's
      // redirect: /users/me is exempt from the verification gate and always
      // 200s, so this check is authoritative and can't itself 400.
      if (me.role === 'CANDIDATE' && (me.phone == null || me.email == null)) {
        const missing = [me.phone == null && 'phone', me.email == null && 'email'].filter(Boolean).join(',');
        setStatus('redirecting');
        router.replace(`/verify?missing=${missing}`);
        return;
      }
      // Best-effort — a failure here (network hiccup, a non-candidate role
      // this endpoint 404s for) should never block an otherwise-working
      // sign-in; it just means a deactivated candidate falls through to the
      // normal dashboard instead of the reactivation prompt this once,
      // which is a worse UX, not a broken one.
      const account = await api<AccountStatus>('/account/status').catch(() => null);
      if (account?.deactivated) {
        setStatus('deactivated');
        return;
      }
    } catch (e) {
      // Genuinely unexpected — /users/me is exempt from the verification
      // gate and can't fail with CANDIDATE_VERIFICATION_INCOMPLETE, so
      // anything caught here is a real problem worth knowing about, not
      // expected app state. Falls through to the candidate dashboard
      // regardless, which has its own error state.
      console.error('resolveRole: unexpected failure resolving /users/me', e);
    }
    setStatus('authed');
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('anon');
      return;
    }
    resolveRole();
  }, [resolveRole]);

  // See REDIRECT_FALLBACK_MS's doc comment — only while a redirect is
  // actually in flight; the ordinary pre-login 'loading' check above
  // resolves on its own and doesn't need this.
  useEffect(() => {
    if (status !== 'redirecting') return;
    const timer = setTimeout(() => setStatus('authed'), REDIRECT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === 'loading') return <main className="app-loading"><p>Loading…</p></main>;
  if (status === 'redirecting') return <RedirectingPlaceholder />;
  if (status === 'anon') return <OtpLogin onLoggedIn={resolveRole} />;
  if (status === 'deactivated') {
    return <ReactivatePrompt onReactivated={resolveRole} onDeclined={() => setStatus('anon')} />;
  }
  return <Dashboard onLoggedOut={() => setStatus('anon')} />;
}

/**
 * Shown only for the bounded window while actually redirecting to /admin or
 * /verify — mirrors lib/candidateVerification.tsx's
 * VerificationRedirectPlaceholder exactly (same reasoning: a candidate must
 * never be stranded here with nothing to do but wait).
 */
function RedirectingPlaceholder() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    window.location.href = '/candidate';
  }

  return (
    <main className="app-loading">
      <p>Loading…</p>
      <button type="button" className="btn-secondary" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </main>
  );
}
