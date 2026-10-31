'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getToken } from '@/lib/api';
import { isBetaPromoActive } from '@/lib/betaPromo';

/**
 * Shared visibility rule for both the thin acquisition bar (BetaPromoBar)
 * and the floating ribbon (BetaPromoScroll): the offer window is still open
 * AND the visitor is signed out of both portals. Route gating is NOT this
 * hook's job — the bar keeps its own path allow-list (it's mounted once,
 * app-wide, and has to exclude most of the app), while the ribbon's two
 * pages mount it directly and need no allow-list at all. Splitting it out
 * here means that rule can't drift between the two call sites the way a
 * copy-pasted version eventually would.
 *
 * `false` until mounted — the server has no localStorage, so reading a
 * token during the render that produces the server HTML (or the first
 * client render that has to match it) would disagree with what mounts a
 * moment later and trip a hydration mismatch. First paint always renders as
 * logged-out; this corrects it immediately after mount.
 *
 * Re-checks on every pathname change, not just once — BetaPromoBar is a
 * true singleton (mounted once in Providers.tsx, never unmounted for the
 * life of the tab), so without this a client-side sign-in while sitting on
 * an allowed route (/faq, /help/*) would leave it showing a logged-out
 * visitor's banner to a now-signed-in one until a hard reload. pathname
 * itself isn't read for anything here (route gating stays BetaPromoBar's
 * job, per this hook's own contract above) — it's only a recheck trigger,
 * since a token change is almost always accompanied by a client-side
 * navigation somewhere in this app. BetaPromoScroll doesn't need this (its
 * two pages unmount it outright on navigation), but taking the same
 * dependency there is harmless, not worth a second code path to avoid.
 */
export function useBetaPromoVisible(): boolean {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const signedOut = !getToken();
    setVisible(isBetaPromoActive() && signedOut);
  }, [pathname]);

  return visible;
}
