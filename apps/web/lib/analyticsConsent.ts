/**
 * DPDP-driven consent gate for the Google Analytics tag (2026-09) — no
 * tracking request fires until a visitor has explicitly chosen "Accept."
 * Three states, one localStorage key: unset (no decision yet — show the
 * banner, never load the tag), 'granted', 'denied'. Deliberately no
 * granular per-category consent (analytics-only vs. marketing vs. ...) —
 * this app has exactly one tag today, so a second consent category would
 * be a distinction with no difference; revisit if a second tracking
 * integration is ever added.
 *
 * Stored value is a JSON record, not a bare string:
 *
 *   { "decision": "granted", "at": "2026-09-14T09:12:33.104Z", "version": 1 }
 *
 * `at` and `version` exist so a decision is a *record* rather than a flag.
 * Without the version there is no way to tell who consented to which
 * disclosure, and no way to re-ask only the people who need re-asking.
 * Retrofitting that later is painful; carrying it costs nothing now.
 *
 * Values written before this change were bare 'granted'/'denied' strings.
 * Those are migrated in place and treated as version 1 with an unknown
 * timestamp — visitors who already accepted are NOT re-prompted.
 */
const CONSENT_KEY = 'myambii-analytics-consent';

/**
 * Bump ONLY when the disclosure materially changes — a new tag, a new
 * category, a different purpose. Bumping invalidates every stored decision
 * and re-shows the banner to everyone, which is the correct behaviour when
 * what you're asking about has changed, and an unnecessary annoyance when
 * it hasn't.
 */
export const CONSENT_VERSION = 1;

export type AnalyticsConsent = 'granted' | 'denied' | null;

export type AnalyticsConsentRecord = {
  decision: 'granted' | 'denied';
  /** ISO 8601. `null` for decisions migrated from the pre-versioning format. */
  at: string | null;
  version: number;
};

function parse(raw: string | null): AnalyticsConsentRecord | null {
  if (!raw) return null;

  // Pre-versioning format: a bare 'granted'/'denied' string.
  if (raw === 'granted' || raw === 'denied') {
    return { decision: raw, at: null, version: 1 };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AnalyticsConsentRecord>;
    if (parsed?.decision !== 'granted' && parsed?.decision !== 'denied') return null;
    return {
      decision: parsed.decision,
      at: typeof parsed.at === 'string' ? parsed.at : null,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
    };
  } catch {
    // Corrupt or foreign value — treat as "no decision yet" rather than
    // guessing. Fails toward asking again, never toward granting.
    return null;
  }
}

/** The full stored record, or null if there's no valid current-version decision. */
export function readAnalyticsConsentRecord(): AnalyticsConsentRecord | null {
  try {
    const record = parse(localStorage.getItem(CONSENT_KEY));
    if (!record) return null;
    // A decision made against an older disclosure isn't consent to this one.
    if (record.version < CONSENT_VERSION) return null;
    return record;
  } catch {
    // Private-browsing/storage-blocked browsers: treat as "no decision yet"
    // rather than throwing — the banner just reappears every visit, which
    // is the safe direction to fail in (never silently grants).
    return null;
  }
}

export function readAnalyticsConsent(): AnalyticsConsent {
  return readAnalyticsConsentRecord()?.decision ?? null;
}

/**
 * Fired on `window` whenever the stored decision changes — AnalyticsGate
 * (the banner) and ConsentSettingsLink (the footer control) are two
 * independent components with no shared React state, each reading
 * localStorage on their own mount. Without this, accepting/declining in the
 * banner never updates the footer link on the *same* page load — it would
 * only pick up the new decision on some later, unrelated navigation. The
 * `storage` event doesn't help here: browsers only fire it for *other*
 * tabs/documents, never the one that made the write.
 */
export const ANALYTICS_CONSENT_CHANGED_EVENT = 'myambii:analytics-consent-changed';

function notifyConsentChanged(): void {
  try {
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_CHANGED_EVENT));
  } catch {
    // Non-browser context — nothing to notify.
  }
}

export function writeAnalyticsConsent(value: 'granted' | 'denied'): void {
  try {
    const record: AnalyticsConsentRecord = {
      decision: value,
      at: new Date().toISOString(),
      version: CONSENT_VERSION,
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // Nothing to do if storage is unavailable — the banner will just ask again next visit.
  }
  notifyConsentChanged();
}

/**
 * Google Analytics cookies set on this domain. `_ga` is the client id;
 * `_ga_<STREAM>` is the session cookie, where <STREAM> is the measurement
 * id minus its "G-" prefix. `_gid`/`_gat` are legacy UA-era cookies that
 * some configurations still set.
 */
function gaCookieNames(): string[] {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '';
  const stream = measurementId.replace(/^G-/, '');
  return ['_ga', '_gid', '_gat', ...(stream ? [`_ga_${stream}`] : [])];
}

/**
 * Delete a cookie without knowing which domain/path scope it was set on.
 * GA sets on the registrable domain (".myambii.com"), but the page may be
 * served from a subdomain, so expire the name against every parent-domain
 * suffix rather than guessing one.
 */
function expireCookie(name: string): void {
  const parts = window.location.hostname.split('.');
  const domains = [
    undefined, // host-only cookie
    ...parts.map((_, i) => parts.slice(i).join('.')).filter((d) => d.includes('.')),
  ];

  for (const domain of domains) {
    for (const suffix of ['', `; domain=.${domain}`, `; domain=${domain}`]) {
      if (domain === undefined && suffix !== '') continue;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${suffix}`;
    }
  }
}

/**
 * Withdraw consent. Clears the stored decision AND the cookies Google has
 * already set, then the caller reloads.
 *
 * The reload is not cosmetic. Once gtag.js has loaded it cannot be
 * unloaded — the instance stays live in memory for the rest of the page's
 * life. Clearing the flag alone would stop the tag loading on the *next*
 * page while leaving it running on this one, which is not what a visitor
 * clicking "withdraw" reasonably expects. Clearing cookies without the
 * reload is worse still: the live gtag would simply write fresh ones.
 */
export function withdrawAnalyticsConsent(): void {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    // If storage is blocked there was no stored decision to remove.
  }

  try {
    for (const name of gaCookieNames()) expireCookie(name);
  } catch {
    // Cookie access can throw in locked-down contexts; the storage clear
    // above is the part that governs whether the tag loads again.
  }

  // The caller reloads right after this (see this function's own doc
  // comment on why), so no same-page listener strictly needs this — kept
  // for symmetry with writeAnalyticsConsent and so this stays correct if
  // a future caller ever withdraws without reloading.
  notifyConsentChanged();
}
