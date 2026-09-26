import type { Metadata } from 'next';
import { routing, type Locale } from '@/i18n/routing';

/**
 * Canonical origin for absolute canonical/hreflang URLs. The apex
 * (myambii.com) 302-redirects to www, so www is the one true host.
 */
export const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.myambii.com';

/** Absolute URL of `path` (unprefixed, e.g. '/' or '/faq') in `locale`. */
export function localizedUrl(locale: Locale, path: string): string {
  const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;
  const tail = path === '/' ? '' : path;
  return `${SITE_ORIGIN}${prefix}${tail || (prefix ? '' : '/')}`;
}

/**
 * `alternates` for a page that exists in every locale: a self-referencing
 * canonical (each locale's page is its own canonical — they are
 * translations, not duplicates), one hreflang per locale, and x-default →
 * the English URL.
 */
export function localeAlternates(locale: Locale, path: string): NonNullable<Metadata['alternates']> {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = localizedUrl(l, path);
  languages['x-default'] = localizedUrl(routing.defaultLocale, path);
  return { canonical: localizedUrl(locale, path), languages };
}
