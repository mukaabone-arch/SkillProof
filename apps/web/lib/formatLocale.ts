/**
 * Number/date formatting decisions, pinned here rather than inherited from
 * whatever each browser or ICU build defaults to.
 *
 * DECISION (2026-09): Western digits (0-9) in every locale, Gregorian
 * calendar in every locale.
 *  - `Intl.NumberFormat('ar')` can return Arabic-Indic digits (٠١٢٣); Gulf
 *    business usage commonly prefers Western digits, and prices, dates and
 *    codes (MYA-EMP-0001) sit beside Latin text. The `-u-nu-latn` extension
 *    pins that.
 *  - Some `ar-*` regions (ar-SA) default to the Hijri calendar. `-ca-gregory`
 *    pins Gregorian. Revisit only if Hijri is ever intended, and then as a
 *    visible choice, not a side effect of the locale tag.
 * English keeps its existing region tags so en output is unchanged.
 *
 * Every date/number call site on a localised surface should build its
 * formatter from `intlTag()`. Sites in surfaces not yet localised
 * (candidate/employer/admin) still use their own en-* tags and move here
 * with their surface.
 */
export function intlTag(locale: string, englishTag = 'en-US'): string {
  return locale === 'ar' ? 'ar-u-nu-latn-ca-gregory' : englishTag;
}
