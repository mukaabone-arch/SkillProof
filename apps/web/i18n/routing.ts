import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing, shared by middleware.ts, the navigation helpers and the
 * request config.
 *
 * `as-needed`: the default locale stays unprefixed (`/`, `/employer`) so
 * every existing URL keeps working with no redirect; the other locale is
 * prefixed (`/ar` on the India site, `/en` on a Gulf site — see
 * DEFAULT_LOCALE below).
 *
 * `localeDetection: false`: no Accept-Language sniffing. The visitor picks
 * a locale with the explicit switcher (LocaleSwitcher), the choice is kept
 * in the NEXT_LOCALE cookie, and middleware.ts honours it for `/` on return
 * visits. Crawlers send no cookie, so what they see never depends on
 * their headers.
 *
 * `alternateLinks: false`: next-intl's own hreflang `Link:` response header
 * is off — hreflang lives in each page's `metadata.alternates` (see
 * lib/localeMetadata.ts), where it sits next to the canonical and can't
 * disagree with it.
 */
/**
 * The unprefixed locale is a per-deployment setting, not a code branch:
 * the India site (myambii.com) builds with the default `en` (Arabic at
 * /ar); a Gulf regional site builds with NEXT_PUBLIC_DEFAULT_LOCALE=ar
 * (English at /en). NEXT_PUBLIC_ values are inlined at build time, so
 * middleware, server and client all see the same value. Anything other
 * than 'ar' means 'en'.
 */
export const DEFAULT_LOCALE: 'en' | 'ar' = process.env.NEXT_PUBLIC_DEFAULT_LOCALE === 'ar' ? 'ar' : 'en';

export const routing = defineRouting({
  locales: ['en', 'ar'],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeDetection: false,
  alternateLinks: false,
});

export type Locale = (typeof routing.locales)[number];

export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Locales written right-to-left. */
export function isRtl(locale: string): boolean {
  return locale === 'ar';
}

/** URL prefix for `locale` on this deployment: '' for the default locale. */
export function localePrefix(locale: string): string {
  return locale === routing.defaultLocale ? '' : `/${locale}`;
}

/**
 * Routes that actually have a translation. Every other route lives under
 * app/[locale]/ too (so the tree is ready for the next passes), but until
 * its surface is translated an Arabic URL for it would be English copy in an
 * RTL shell — middleware.ts sends those to the English URL instead.
 * Add a path here in the same change that translates it.
 */
export const LOCALIZED_PATHS: readonly string[] = ['/', '/employer/dashboard', '/employer/jobs/[id]/matches'];

/**
 * Whether `path` (the part after `/ar`, trailing slash already optional) has
 * a translation. Literal entries match exactly; a `[param]` segment matches
 * any single path segment, so `/employer/candidates/[id]/portfolio` covers
 * every candidate's portfolio. Without this, a dynamic route's real URL
 * never equals its literal entry and bounces to English mid-walkthrough.
 */
export function isLocalizedPath(path: string, paths: readonly string[] = LOCALIZED_PATHS): boolean {
  const normalised = path.replace(/\/$/, '') || '/';
  return paths.some((entry) => {
    if (!entry.includes('[')) return entry === normalised;
    const pattern = entry.replace(/\[[^\]]+\]/g, '[^/]+');
    return new RegExp(`^${pattern}$`).test(normalised);
  });
}
