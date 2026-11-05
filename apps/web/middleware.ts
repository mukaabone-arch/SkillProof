import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { isLocalizedPath, LOCALE_COOKIE, localePrefix, routing, type Locale } from './i18n/routing';

/**
 * LOCALE ROUTING ONLY. This is the app's first and only middleware, and it
 * must stay that way: no authentication, no session-based redirects, no
 * header inspection, no authorization decisions. Authorization lives
 * entirely in the NestJS guards (apps/api) and, for the portals, in the
 * client-side entry guards (lib/useRequireAuth.ts) — never here.
 *
 * Why that is a hard rule and not a preference: CVE-2025-29927 is an
 * authorization bypass in Next.js middleware (a forged
 * `x-middleware-subrequest` header skips it). This app had no middleware,
 * so it had no exposure. It has one now, so the patched-version floor is
 * load-bearing: `next` must stay >= 14.2.25 (package.json pins ^14.2.35 —
 * do not lower it). The exposure is nil only because nothing here decides
 * who may see what; if this file ever starts to, the CVE becomes live for
 * that logic.
 *
 * Two things beyond next-intl's own routing, both about locale only:
 *  1. `/` with a NEXT_LOCALE cookie naming the non-default locale goes to
 *     that locale's prefix (the visitor's own earlier choice — never
 *     Accept-Language).
 *  2. An Arabic URL for a path with no translation yet goes to the English
 *     URL (see LOCALIZED_PATHS). The default locale is a deployment
 *     setting (i18n/routing.ts), so on a Gulf site that is `/foo` -> `/en/foo`.
 */
const intlMiddleware = createIntlMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    return NextResponse.redirect(url);
  };

  // 1. `/` with an explicit choice of the non-default locale.
  const chosen = request.cookies.get(LOCALE_COOKIE)?.value;
  if (pathname === '/' && chosen && chosen !== routing.defaultLocale && routing.locales.includes(chosen as Locale)) {
    return redirectTo(`/${chosen}`);
  }

  // 2. Arabic URL for a path with no translation yet -> the English URL.
  //    Which URL is "Arabic" depends on the deployment: `/ar/...` where
  //    English is the default, every unprefixed path where Arabic is.
  const prefixed = pathname.match(/^\/(en|ar)(\/.*)?$/);
  const locale = prefixed ? prefixed[1] : routing.defaultLocale;
  const rest = prefixed ? prefixed[2] ?? '/' : pathname;
  if (locale === 'ar' && !isLocalizedPath(rest)) {
    return redirectTo(`${localePrefix('en')}${rest === '/' ? '' : rest}` || '/');
  }

  return intlMiddleware(request);
}

export const config = {
  // Everything except API-ish paths, Next internals and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
