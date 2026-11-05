'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { LOCALE_COOKIE, routing, type Locale } from '@/i18n/routing';

/**
 * Explicit language switcher — the ONLY way the locale changes (no
 * Accept-Language detection; see i18n/routing.ts). Two-locale app, so it
 * is a single link to "the other one", labelled in that language's own
 * name (the autonym, which is also what a reader who can't read the
 * current page needs to find).
 *
 * A plain <a>, not a client-side <Link>: switching flips <html lang/dir>
 * and the font set loaded in <head>, which a full navigation gets right
 * for free. It keeps the current path (usePathname is locale-stripped),
 * and records the choice in the NEXT_LOCALE cookie so middleware.ts can
 * honour it on the next visit to `/`. The cookie is written on click,
 * before the navigation, so choosing English is honoured too.
 *
 * `hrefLang`/`lang` mark the link as being in the target language.
 */
export default function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations('locale');
  const locale = useLocale();
  const pathname = usePathname();

  const target: Locale = routing.locales.find((l) => l !== locale) ?? routing.defaultLocale;
  const prefix = target === routing.defaultLocale ? '' : `/${target}`;
  const href = `${prefix}${pathname === '/' ? '' : pathname}` || '/';

  return (
    <a
      href={href}
      hrefLang={target}
      lang={target}
      className={className}
      aria-label={`${t('label')}: ${t(target)}`}
      onClick={() => {
        try {
          document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
        } catch {
          // Cookies blocked: the link still navigates; only "remember my choice" is lost.
        }
      }}
    >
      {t(target)}
    </a>
  );
}
