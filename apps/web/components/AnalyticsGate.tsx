'use client';

/**
 * Google Analytics (2026-09), gated two ways at once:
 *
 * 1. Environment — reads NEXT_PUBLIC_GA_MEASUREMENT_ID with no hardcoded
 *    fallback anywhere in code. This must be set only in the real
 *    production deployment's environment config (the hosting platform's
 *    own env-var settings, never committed to this repo — see
 *    .env.example). Unset in local dev and any staging/preview
 *    environment, this component renders nothing at all, so local/staging
 *    traffic can never land in the same GA4 property as production.
 *
 * 2. Consent (DPDP) — even in production, no tracking request fires until
 *    the visitor explicitly accepts. Three states (see
 *    lib/analyticsConsent.ts): no decision yet -> show the banner, load
 *    nothing; 'granted' -> mount the tag; 'denied' -> render nothing,
 *    don't ask again this session-or-ever (until localStorage is cleared).
 *
 * @next/third-parties/google's <GoogleAnalytics> is the official Next.js
 * package for this — it injects gtag.js and the config call, and (per
 * GA4's own "Enhanced measurement") relies on the browser's History API
 * events to catch client-side route changes, the same as vanilla gtag.js
 * would. That's a real assumption, not a guarantee this environment could
 * verify — confirm SPA route changes actually register as separate
 * page_views in GA4 DebugView once this is live; if they don't, add an
 * explicit page_view call on each Next.js route change (usePathname +
 * window.gtag('event', 'page_view', ...)) rather than assuming enhanced
 * measurement caught it.
 *
 * No Content-Security-Policy exists anywhere in this project today — see
 * next.config.mjs's own comment for what a future one must allow
 * (script-src https://www.googletagmanager.com) or this silently stops
 * working for every visitor who's accepted, with no error visible in the
 * app itself.
 */
import { useEffect, useState } from 'react';
import { GoogleAnalytics } from '@next/third-parties/google';
import ConsentBanner from './ConsentBanner';
import { readAnalyticsConsent, writeAnalyticsConsent, type AnalyticsConsent } from '@/lib/analyticsConsent';

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function AnalyticsGate() {
  // Read localStorage only after mount (it's unavailable during server
  // rendering) — `hydrated` gates the first render so the banner can't
  // flash on, then off, before the stored decision is known.
  const [consent, setConsent] = useState<AnalyticsConsent>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setConsent(readAnalyticsConsent());
    setHydrated(true);
  }, []);

  if (!GA_MEASUREMENT_ID || !hydrated) return null;

  if (consent === 'granted') return <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />;
  if (consent === 'denied') return null;

  return (
    <ConsentBanner
      onAccept={() => {
        writeAnalyticsConsent('granted');
        setConsent('granted');
      }}
      onDecline={() => {
        writeAnalyticsConsent('denied');
        setConsent('denied');
      }}
    />
  );
}
