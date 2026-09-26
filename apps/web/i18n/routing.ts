import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing, shared by middleware.ts, the navigation helpers and the
 * request config.
 *
 * `as-needed`: English stays unprefixed (`/`, `/employer`) so every
 * existing URL keeps working with no redirect; Arabic is prefixed (`/ar`).
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
export const routing = defineRouting({
  locales: ['en'], // 'ar' joins in the second step of the Arabic rollout
  defaultLocale: 'en',
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

/**
 * Routes that actually have a translation. Every other route lives under
 * app/[locale]/ too (so the tree is ready for the next passes), but until
 * its surface is translated `/ar/<path>` would be English copy in an RTL
 * shell — middleware.ts sends those to the unprefixed English URL instead.
 * Add a path here in the same change that translates it.
 */
export const LOCALIZED_PATHS: readonly string[] = ['/'];
