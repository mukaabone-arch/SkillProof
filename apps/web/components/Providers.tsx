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
 */
import { ReactNode } from 'react';
import { EntitlementsProvider } from '@/lib/entitlements';
import { CandidateVerificationProvider } from '@/lib/candidateVerification';
import LimitReachedModal from './LimitReachedModal';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <CandidateVerificationProvider>
      <EntitlementsProvider>
        {children}
        <LimitReachedModal />
      </EntitlementsProvider>
    </CandidateVerificationProvider>
  );
}
