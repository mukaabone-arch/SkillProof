/**
 * DPDP-driven consent gate for the Google Analytics tag (2026-09) — no
 * tracking request fires until a visitor has explicitly chosen "Accept."
 * Three states, one localStorage key: unset (no decision yet — show the
 * banner, never load the tag), 'granted', 'denied'. Deliberately no
 * granular per-category consent (analytics-only vs. marketing vs. ...) —
 * this app has exactly one tag today, so a second consent category would
 * be a distinction with no difference; revisit if a second tracking
 * integration is ever added.
 */
const CONSENT_KEY = 'myambii-analytics-consent';

export type AnalyticsConsent = 'granted' | 'denied' | null;

export function readAnalyticsConsent(): AnalyticsConsent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    // Private-browsing/storage-blocked browsers: treat as "no decision yet"
    // rather than throwing — the banner just reappears every visit, which
    // is the safe direction to fail in (never silently grants).
    return null;
  }
}

export function writeAnalyticsConsent(value: 'granted' | 'denied'): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Nothing to do if storage is unavailable — the banner will just ask again next visit.
  }
}
