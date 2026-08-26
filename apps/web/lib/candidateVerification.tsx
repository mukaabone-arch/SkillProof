'use client';

/**
 * Hard gate: a signed-in CANDIDATE with an incomplete phone+email pair gets
 * redirected to /verify from anywhere else in the app. Mirrors
 * EntitlementsProvider's shape exactly (fetch once per token via a ref,
 * `refetch()` for callers that just changed the underlying state) — see
 * that file's own doc comment — but unlike EntitlementsProvider this
 * provider also performs the redirect itself, since a hard gate is a side
 * effect, not just data for consumers to react to.
 *
 * UX courtesy only — apps/api's CandidateVerificationGuard (which runs as
 * part of JwtAuthGuard on every authenticated request) is the real
 * enforcement; a failure or a missed case here can inconvenience but never
 * actually let an unverified candidate reach real data.
 *
 * Mounted once at the app root (see components/Providers.tsx), so it also
 * runs on /employer and /admin pages — GATE_EXEMPT_PATH_PREFIXES excludes
 * those outright (a stray candidate token in the same browser must never
 * redirect an employer/admin session away from their own portal), and
 * /users/me itself returns `verified: null` for any non-CANDIDATE role
 * (PLATFORM_ADMIN included — see app/candidate/page.tsx's own comment on
 * admin sharing the candidate OTP login) as a second, independent reason
 * this never fires for them.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, getToken } from './api';

interface Me {
  role: string;
  phone: string | null;
  email: string | null;
}

interface CandidateVerificationState {
  /** null: unknown, not yet checked, or not a CANDIDATE (gate doesn't apply). false only once a CANDIDATE is confirmed incomplete. */
  verified: boolean | null;
  loading: boolean;
}

interface CandidateVerificationContextValue extends CandidateVerificationState {
  /** Call after a successful /auth/link/phone or /auth/link/email verify, before navigating away from /verify — otherwise this provider's cached `false` would immediately redirect right back. */
  refetch: () => Promise<void>;
}

const EMPTY_STATE: CandidateVerificationState = { verified: null, loading: false };

const CandidateVerificationContext = createContext<CandidateVerificationContextValue | null>(null);

/** Path prefixes the gate never touches at all — no fetch, no redirect. */
const GATE_EXEMPT_PATH_PREFIXES = ['/employer', '/admin', '/verify'];
/** Single exact-match exemption: the account-settings escape hatch (deactivate/delete/export). */
const GATE_EXEMPT_PATHS = ['/profile/account'];

function isExempt(pathname: string): boolean {
  return GATE_EXEMPT_PATHS.includes(pathname) || GATE_EXEMPT_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

export function CandidateVerificationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CandidateVerificationState>(EMPTY_STATE);
  const fetchedForToken = useRef<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const fetchStatus = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const me = await api<Me>('/users/me');
      const verified = me.role !== 'CANDIDATE' ? null : me.phone != null && me.email != null;
      setState({ verified, loading: false });
    } catch {
      // Best-effort — same "never itself lock someone out on a network
      // hiccup" reasoning as app/employer/layout.tsx's own gate check.
      setState({ verified: null, loading: false });
    }
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      fetchedForToken.current = null;
      if (state.verified !== null) setState(EMPTY_STATE);
      return;
    }
    if (isExempt(pathname)) return;

    if (fetchedForToken.current !== token) {
      fetchedForToken.current = token;
      void fetchStatus();
      return;
    }

    if (state.verified === false) router.replace('/verify');
  }, [pathname, state.verified, fetchStatus, router]);

  return (
    <CandidateVerificationContext.Provider value={{ ...state, refetch: fetchStatus }}>
      {children}
    </CandidateVerificationContext.Provider>
  );
}

export function useCandidateVerification(): CandidateVerificationContextValue {
  const ctx = useContext(CandidateVerificationContext);
  if (!ctx) throw new Error('useCandidateVerification must be used within a CandidateVerificationProvider');
  return ctx;
}
