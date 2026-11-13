/**
 * Best guess at the visitor's country, sent to the API as X-Client-Country.
 * The API uses it once, the first time it sees a candidate, to decide
 * whether a verified phone is required: our SMS codes only reach Indian
 * numbers, so outside India a verified email is enough.
 *
 * The time zone decides India (Asia/Kolkata, or its old name Asia/Calcutta),
 * since many people in India use an en-US browser. Elsewhere the browser
 * language's region is used ("en-AE" → "AE"), and "ZZ" means "not India,
 * country unknown". Returns null only when nothing can be read (no Intl).
 */
const INDIA_TIME_ZONES = ['Asia/Kolkata', 'Asia/Calcutta'];

export function clientCountry(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && INDIA_TIME_ZONES.includes(tz)) return 'IN';
    const lang = typeof navigator !== 'undefined' ? navigator.language : '';
    const region = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(lang || '')?.[1]?.toUpperCase();
    // An "-IN" language with a non-Indian time zone is most likely someone
    // abroad on a Gulf/Western network, but still an Indian number holder
    // more often than not; keep the strict rule for them.
    if (region) return region;
    return tz ? 'ZZ' : null;
  } catch {
    return null;
  }
}
