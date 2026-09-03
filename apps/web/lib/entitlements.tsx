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
import { api, getToken, type ApiError } from './api';

export type SubscriptionTier = 'FREE' | 'PREMIUM';

/** Mirrors apps/api/src/config/plans.config.ts's PlanLimits shape exactly — field names/types only, never a value. */
export interface PlanLimits {
  assessmentsPerMonth: number | null;
  /** AI discussion-session (conversational assessor) starts allowed per month — separate metric/quota from assessmentsPerMonth (MCQ). See plans.config.ts. */
  discussionSessionsPerMonth: number | null;
  retakeCooldownDays: number;
  retakesPerSkillLifetime: number;
  /** When true (FREE today), self-serve MCQ attempts are locked to a single skill for life — see freeSkillLock below. */
  singleSkillRestriction: boolean;
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

/** Null before the candidate's first self-serve MCQ attempt, or when limits.singleSkillRestriction is false — see apps/api's EntitlementsResponse.freeSkillLock doc comment. */
export type FreeSkillLock = { skillId: string; skillName: string } | null;

export interface EntitlementsResponse {
  tier: SubscriptionTier;
  limits: PlanLimits;
  usage: {
    assessments: UsageEntry;
    applications: UsageEntry;
    discussionSessions: UsageEntry;
  };
  freeSkillLock: FreeSkillLock;
}

interface EntitlementsState {
  /** null while loading, or when there is no signed-in candidate session. */
  tier: SubscriptionTier | null;
  limits: PlanLimits | null;
  usage: EntitlementsResponse['usage'] | null;
  freeSkillLock: FreeSkillLock;
  loading: boolean;
  error: string | null;
}

interface EntitlementsContextValue extends EntitlementsState {
  refetch: () => Promise<void>;
}

const EMPTY_STATE: EntitlementsState = { tier: null, limits: null, usage: null, freeSkillLock: null, loading: false, error: null };

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
      setState({ tier: res.tier, limits: res.limits, usage: res.usage, freeSkillLock: res.freeSkillLock, loading: false, error: null });
    } catch (e) {
      // An unverified candidate 400s here (apps/api's CandidateVerificationGuard)
      // until they finish /verify — expected app state, not an entitlements
      // failure. Never surfaced as `error` (nothing should render it) and
      // never logged as a failure; CandidateVerificationProvider is what
      // actually reacts to this (see candidateVerificationBus).
      const code = (e as ApiError).body && typeof (e as ApiError).body === 'object'
        ? ((e as ApiError).body as { code?: string }).code
        : undefined;
      if (code === 'CANDIDATE_VERIFICATION_INCOMPLETE') {
        setState({ ...EMPTY_STATE, loading: false });
        return;
      }
      console.error('EntitlementsProvider: unexpected failure fetching /me/entitlements', e);
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
