'use client';

/**
 * Hard gate: a signed-in CANDIDATE with an incomplete phone+email pair is
 * redirected to /verify. UX courtesy only — apps/api's
 * CandidateVerificationGuard (part of JwtAuthGuard, every authenticated
 * request) is the real enforcement; nothing here can actually let an
 * unverified candidate reach real data, so this file's only job is to be a
 * *good citizen* about it, never a *strict* one.
 *
 * FAILS OPEN, DELIBERATELY, EVERYWHERE: every terminal state — fetch
 * success, fetch failure, a non-200 response, and a hard timeout if
 * nothing resolves at all — ends in a definite status, and the only status
 * that withholds `children` is a CONFIRMED 'incomplete'. Anything else
 * (unknown, a network hiccup, a non-CANDIDATE role, no token) renders
 * `children` immediately. This replaced an earlier version that withheld
 * children while status was merely 'unknown', reasoning that this
 * prevented Dashboard's own gated fetches from ever firing — in practice
 * that version could get stuck showing the loading placeholder forever
 * with no escape, which is strictly worse than the raw-error-text bug it
 * replaced: a 400 on screen is recoverable (reload, navigate away); an
 * unresolvable "Loading…" with no logout button is not. See RESOLUTION_TIMEOUT_MS
 * below and the logout button on the placeholder — both exist specifically
 * so there is no path where a candidate is stuck with no way out.
 *
 * DEFENSE IN DEPTH: candidateVerificationBus. lib/api.ts publishes there
 * the moment ANY endpoint returns 400 CANDIDATE_VERIFICATION_INCOMPLETE —
 * this provider treats that as definitive (skips re-checking /users/me)
 * and redirects. This covers the case where the proactive /users/me check
 * hasn't resolved yet yet but a gated child fetch already reveals the
 * answer, without needing every page's own error handling to know about
 * this error code.
 *
 * Mounted once at the app root, inside EntitlementsProvider (see
 * components/Providers.tsx — deliberately NOT wrapping EntitlementsProvider
 * or LimitReachedModal), so it also runs on /employer and /admin pages —
 * GATE_EXEMPT_PATH_PREFIXES excludes those outright, and /users/me itself
 * resolves to the 'not-applicable' status for any non-CANDIDATE role
 * (PLATFORM_ADMIN included — see app/candidate/page.tsx's own comment on
 * admin sharing the candidate OTP login) as a second, independent reason
 * this never blocks or redirects for them.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, getToken, logout } from './api';
import { onCandidateVerificationIncomplete } from './candidateVerificationBus';
import { onCandidateTokenChange } from './tokenChangeBus';

interface Me {
  role: string;
  phone: string | null;
  email: string | null;
}

type VerificationStatus =
  | 'unknown' // not yet checked for the current token — renders children (fail open), not a blocking state
  | 'not-applicable' // no token, checked and role isn't CANDIDATE, or the check failed/timed out
  | 'incomplete' // CANDIDATE, confirmed missing phone or email — the only status that withholds children
  | 'complete'; // CANDIDATE, both present

interface CandidateVerificationState {
  status: VerificationStatus;
}

interface CandidateVerificationContextValue {
  /** Derived from status — null while unknown/not-applicable, true/false once a CANDIDATE's status is actually known. */
  verified: boolean | null;
  loading: boolean;
  /** Call after a successful /auth/link/phone or /auth/link/email verify, before navigating away from /verify — otherwise this provider's cached 'incomplete' would immediately redirect right back. */
  refetch: () => Promise<void>;
}

const CandidateVerificationContext = createContext<CandidateVerificationContextValue | null>(null);

/**
 * Path prefixes the gate never touches at all — no fetch, no redirect.
 * /candidate is exempt too, deliberately: app/candidate/page.tsx's own
 * resolveRole() already resolves /users/me and redirects to /verify (with
 * its own bounded-fallback placeholder + logout button, mirroring this
 * file's own) before Dashboard ever mounts, called directly from
 * OtpLogin's onLoggedIn rather than from an effect — which is what makes it
 * immune to the "state change, not a mount" gap this provider's own
 * pathname-effect has for every other route. Letting this provider ALSO
 * fetch/block/redirect on /candidate was actively harmful, not just
 * redundant: with the router mocked in tests (and, in principle, if a real
 * navigation is ever slow), this provider could block and unmount
 * app/candidate/page.tsx behind its own generic placeholder mid-flight,
 * then unblock and let it remount and retry — churn with no benefit, since
 * /candidate already has its own complete, independently-verified handling.
 */
const GATE_EXEMPT_PATH_PREFIXES = ['/employer', '/admin', '/verify', '/candidate'];
/** Single exact-match exemption: the account-settings escape hatch (deactivate/delete/export). */
const GATE_EXEMPT_PATHS = ['/profile/account'];

function isExempt(pathname: string): boolean {
  return GATE_EXEMPT_PATHS.includes(pathname) || GATE_EXEMPT_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Only the redirect itself is guarded by a ref (redirectedForTokenRef) —
 * not the whole check — so a slow /users/me can never leave the app
 * hanging: real page content is never withheld while status is merely
 * 'unknown' (see the top-of-file doc comment). This constant only bounds
 * how long a *known-incomplete* candidate sits on the redirect-in-flight
 * placeholder before this gives up waiting on the browser to actually
 * finish navigating and just falls back to rendering children — a second,
 * independent safety net alongside the one-shot redirect guard below.
 */
const REDIRECT_FALLBACK_MS = 4000;

export function CandidateVerificationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CandidateVerificationState>({ status: 'unknown' });
  const [redirecting, setRedirecting] = useState(false);
  const fetchedForToken = useRef<string | null>(null);
  // Guards the actual router.replace() call so it only ever fires once per
  // token, however many times status transitions to 'incomplete' (the
  // proactive check and the bus can both trigger it) — never a repeated or
  // restarted navigation.
  const redirectedForToken = useRef<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const fetchStatus = useCallback(async () => {
    try {
      const me = await api<Me>('/users/me');
      const status: VerificationStatus =
        me.role !== 'CANDIDATE'
          ? 'not-applicable'
          : me.phone != null && me.email != null
            ? 'complete'
            : 'incomplete';
      setState({ status });
    } catch (e) {
      // Fail open — a network hiccup, a timeout upstream, or an
      // unexpected response must never trap anyone here. The server-side
      // guard is the real enforcement regardless. /users/me is exempt from
      // the verification gate and always 200s for a real candidate, so
      // anything landing here is a genuine, worth-logging failure — never
      // CANDIDATE_VERIFICATION_INCOMPLETE itself, which isn't an error path.
      console.error('CandidateVerificationProvider: unexpected failure resolving /users/me', e);
      setState({ status: 'not-applicable' });
    }
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      fetchedForToken.current = null;
      redirectedForToken.current = null;
      if (state.status !== 'not-applicable') setState({ status: 'not-applicable' });
      return;
    }
    if (isExempt(pathname)) return;

    if (fetchedForToken.current !== token) {
      fetchedForToken.current = token;
      void fetchStatus();
      return;
    }

    if (state.status === 'incomplete' && redirectedForToken.current !== token) {
      redirectedForToken.current = token;
      setRedirecting(true);
      router.replace('/verify');
    }
  }, [pathname, state.status, fetchStatus, router]);

  // Closes the gap the effect above can't: a login (or logout) that happens
  // client-side with no navigation and no other prop/state change this
  // component observes. lib/api.ts's candidate client publishes here the
  // instant setTokens()/clearTokens() runs, so this fires immediately on
  // the actual state change rather than waiting on some other dependency
  // (pathname, an unrelated re-render) to coincidentally trigger the effect
  // above. app/candidate/page.tsx's own resolveRole() closes this same gap
  // for its own page more directly (called straight from OtpLogin's
  // onLoggedIn, not via an effect at all); this is the equivalent fix for
  // every other candidate-app route a login could theoretically happen on.
  useEffect(() => {
    return onCandidateTokenChange(() => {
      const token = getToken();
      if (!token) {
        fetchedForToken.current = null;
        redirectedForToken.current = null;
        setState({ status: 'not-applicable' });
        return;
      }
      if (isExempt(pathname)) return;
      fetchedForToken.current = token;
      void fetchStatus();
    });
  }, [pathname, fetchStatus]);

  // Defense in depth — see this file's own doc comment.
  useEffect(() => {
    return onCandidateVerificationIncomplete(() => {
      setState((s) => (s.status === 'incomplete' ? s : { status: 'incomplete' }));
    });
  }, []);

  // Second safety net: once a redirect has actually been requested, stop
  // withholding children after a bounded wait regardless of whether the
  // navigation visibly completed — see REDIRECT_FALLBACK_MS's own doc
  // comment. Resets whenever a fresh redirect is requested.
  useEffect(() => {
    if (!redirecting) return;
    const timer = setTimeout(() => setRedirecting(false), REDIRECT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [redirecting]);

  // The only condition that ever withholds children: a CONFIRMED incomplete
  // candidate, and only for the bounded window while the redirect is
  // actually in flight. 'unknown' is never blocking — see top-of-file doc
  // comment on failing open.
  const blocking = redirecting && !isExempt(pathname) && state.status === 'incomplete';

  return (
    <CandidateVerificationContext.Provider
      value={{
        verified: state.status === 'complete' ? true : state.status === 'incomplete' ? false : null,
        loading: state.status === 'unknown',
        refetch: fetchStatus,
      }}
    >
      {blocking ? <VerificationRedirectPlaceholder /> : children}
    </CandidateVerificationContext.Provider>
  );
}

/**
 * Shown only for the bounded window while actually redirecting an
 * incomplete candidate to /verify. Always has its own way out — a
 * candidate must never be stranded here with nothing to do but wait.
 */
function VerificationRedirectPlaceholder() {
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

export function useCandidateVerification(): CandidateVerificationContextValue {
  const ctx = useContext(CandidateVerificationContext);
  if (!ctx) throw new Error('useCandidateVerification must be used within a CandidateVerificationProvider');
  return ctx;
}
