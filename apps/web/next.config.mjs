import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // MIDDLEWARE EXISTS (middleware.ts, added 2026-09 for next-intl locale
  // routing). Before that this app had none, so CVE-2025-29927 (Next.js
  // middleware authorization bypass via a forged x-middleware-subrequest
  // header) had no surface here. It has one now: the patched `next` floor
  // (>= 14.2.25; package.json pins ^14.2.35) is load-bearing, not
  // precautionary — do not lower it. The middleware does locale routing
  // only and makes no authorization decision, which is what keeps the CVE
  // harmless; keep it that way (see middleware.ts).
  // No Content-Security-Policy is configured anywhere in this project today
  // (2026-09). If one gets added here (via `headers()`) or at the reverse
  // proxy/ALB in front of this app, it must allow script-src
  // https://www.googletagmanager.com — that's what AnalyticsGate.tsx's
  // consent-gated <GoogleAnalytics> tag loads from. Forgetting this makes
  // analytics silently stop for every visitor who's accepted, with no
  // visible error anywhere in the app itself (only in the browser console).
};
export default withNextIntl(nextConfig);
