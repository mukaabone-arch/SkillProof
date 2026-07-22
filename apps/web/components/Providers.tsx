'use client';

/**
 * App-root client providers, kept separate from app/layout.tsx (a server
 * component, for the `metadata` export) — the standard Next.js App Router
 * split. Mounted once for the whole app lifetime: EntitlementsProvider is a
 * true singleton across client-side navigations, which is what makes "fetch
 * once per session" in lib/entitlements.tsx actually hold. Harmless on
 * pages with no candidate session (marketing/employer pages) — the
 * provider's own effect no-ops without a candidate token.
 */
import { ReactNode } from 'react';
import { EntitlementsProvider } from '@/lib/entitlements';
import LimitReachedModal from './LimitReachedModal';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <EntitlementsProvider>
      {children}
      <LimitReachedModal />
    </EntitlementsProvider>
  );
}
