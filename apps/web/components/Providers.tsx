'use client';

/**
 * App-root client providers, kept separate from app/layout.tsx (a server
 * component, for the `metadata` export) — the standard Next.js App Router
 * split. Mounted once for the whole app lifetime: EntitlementsProvider and
 * CandidateVerificationProvider are both true singletons across
 * client-side navigations, which is what makes "fetch once per session" in
 * lib/entitlements.tsx / lib/candidateVerification.tsx actually hold.
 * Harmless on pages with no candidate session (marketing/employer pages) —
 * both providers' own effects no-op without a candidate token, and
 * CandidateVerificationProvider additionally excludes /employer and /admin
 * outright (see its own doc comment).
 *
 * CandidateVerificationProvider wraps only `children` here, deliberately
 * INSIDE EntitlementsProvider and never wrapping LimitReachedModal — it
 * withholds its own `children` (a full-page loading placeholder instead)
 * while an unverified candidate's status is being resolved, and neither
 * EntitlementsProvider (a true app-wide singleton — see its own doc
 * comment) nor the always-mounted LimitReachedModal should ever be
 * unmounted by that.
 *
 * AnalyticsGate is the same shape as LimitReachedModal — an always-mounted,
 * app-wide singleton sitting outside the candidate-verification gate, so
 * the consent banner (or the tag itself, once accepted) is reachable from
 * every page regardless of sign-in/verification state. See its own doc
 * comment for the environment + consent gating it does before anything
 * actually loads.
 */
import { ReactNode } from 'react';
import { EntitlementsProvider } from '@/lib/entitlements';
import { CandidateVerificationProvider } from '@/lib/candidateVerification';
import LimitReachedModal from './LimitReachedModal';
import AssessmentBlockedModal from './AssessmentBlockedModal';
import AnalyticsGate from './AnalyticsGate';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <EntitlementsProvider>
      <CandidateVerificationProvider>{children}</CandidateVerificationProvider>
      <LimitReachedModal />
      <AssessmentBlockedModal />
      <AnalyticsGate />
    </EntitlementsProvider>
  );
}
