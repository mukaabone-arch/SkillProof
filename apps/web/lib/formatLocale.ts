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
/**
 * Numbers inside translated messages. A bare `{count}` is inserted as-is
 * (String(count): Western digits, no grouping), but `#` inside a plural and
 * `{count, number}` go through Intl.NumberFormat(<page locale>) — and for
 * `ar` whether that gives 0-9 or ٠-٩ depends on the browser's CLDR data
 * (ar-SA gives ٠-٩). One `#` in a translation would put "١٢ يومًا" beside a
 * KPI tile showing "12". So Arabic messages write every number argument as
 * `{n, number, latn}` (never `#`), using the named format below. Wired into i18n/request.ts
 * (server), app/[locale]/layout.tsx (client provider) and the test renderer.
 */
export const MESSAGE_FORMATS = {
  number: { latn: { numberingSystem: 'latn' } },
} as const;

export function intlTag(locale: string, englishTag = 'en-US'): string {
  return locale === 'ar' ? 'ar-u-nu-latn-ca-gregory' : englishTag;
}
