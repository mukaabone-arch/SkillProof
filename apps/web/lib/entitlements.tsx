'use client';

/**
 * Single source of truth for the candidate's subscription tier/limits/usage
 * — mirrors GET /me/entitlements exactly (see apps/api's entitlements
 * README for the frozen response contract). Fetched once per session
 * (EntitlementsProvider, mounted once at the app root — see
 * components/Providers.tsx) into this context; every gated surface reads
 * from useEntitlements() instead of hardcoding a tier check or a limit
 * number. Call refetch() after any action that consumes quota (applying to
 * a job, starting an assessment) so displayed meters never go stale — the
 * API also refunds quota on a downstream 4xx, so a validation failure must
 * never be handled by optimistically decrementing a local counter; refetch
 * is the only correct way to reflect that.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { api, getToken } from './api';

export type SubscriptionTier = 'FREE' | 'PREMIUM';

/** Mirrors apps/api/src/config/plans.config.ts's PlanLimits shape exactly — field names/types only, never a value. */
export interface PlanLimits {
  assessmentsPerMonth: number | null;
  retakeCooldownDays: number;
  retakesPerSkillLifetime: number;
  applicationsPerMonth: number | null;
  profileViewers: 'count_only' | 'full';
  applicationStatusDetail: boolean;
  searchRankBoost: number;
  gapAnalysis: 'basic' | 'detailed';
  resumeBranding: boolean;
  resumeTemplates: string[];
  interviewPrep: boolean;
}

export interface UsageEntry {
  used: number;
  limit: number | null;
  /** ISO string — start of the next UTC calendar month. */
  resetsAt: string;
}

export interface EntitlementsResponse {
  tier: SubscriptionTier;
  limits: PlanLimits;
  usage: {
    assessments: UsageEntry;
    applications: UsageEntry;
  };
}

interface EntitlementsState {
  /** null while loading, or when there is no signed-in candidate session. */
  tier: SubscriptionTier | null;
  limits: PlanLimits | null;
  usage: EntitlementsResponse['usage'] | null;
  loading: boolean;
  error: string | null;
}

interface EntitlementsContextValue extends EntitlementsState {
  refetch: () => Promise<void>;
}

const EMPTY_STATE: EntitlementsState = { tier: null, limits: null, usage: null, loading: false, error: null };

const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EntitlementsState>(EMPTY_STATE);
  // Session-scoped, not route-scoped — guards against refetching on every
  // navigation; only refetch() (called explicitly after a quota-consuming
  // action) or a fresh login is allowed to trigger another fetch.
  const fetchedForToken = useRef<string | null>(null);
  const pathname = usePathname();

  const fetchEntitlements = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api<EntitlementsResponse>('/me/entitlements');
      setState({ tier: res.tier, limits: res.limits, usage: res.usage, loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  // Runs on mount and on every route change — cheap (just a token check)
  // unless the token has actually changed since the last successful fetch,
  // which is what makes this fire exactly once per login (first render
  // after OTP/OAuth verify navigates somewhere new) and reset cleanly on
  // logout (token disappears → state clears → next login re-fetches).
  useEffect(() => {
    const token = getToken();
    if (!token) {
      fetchedForToken.current = null;
      setState(EMPTY_STATE);
      return;
    }
    if (fetchedForToken.current === token) return;
    fetchedForToken.current = token;
    void fetchEntitlements();
  }, [pathname, fetchEntitlements]);

  return (
    <EntitlementsContext.Provider value={{ ...state, refetch: fetchEntitlements }}>
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements(): EntitlementsContextValue {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) throw new Error('useEntitlements must be used within an EntitlementsProvider');
  return ctx;
}
