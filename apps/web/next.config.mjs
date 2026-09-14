/** @type {import('next').NextConfig} */
const nextConfig = {
  // No Content-Security-Policy is configured anywhere in this project today
  // (2026-09). If one gets added here (via `headers()`) or at the reverse
  // proxy/ALB in front of this app, it must allow script-src
  // https://www.googletagmanager.com — that's what AnalyticsGate.tsx's
  // consent-gated <GoogleAnalytics> tag loads from. Forgetting this makes
  // analytics silently stop for every visitor who's accepted, with no
  // visible error anywhere in the app itself (only in the browser console).
};
export default nextConfig;
