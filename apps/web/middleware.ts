import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, LOCALIZED_PATHS, routing } from './i18n/routing';

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
 *  1. `/` with an NEXT_LOCALE=ar cookie goes to `/ar` (the visitor's own
 *     earlier choice — never Accept-Language).
 *  2. `/ar/<path>` for a path with no translation yet goes to the English
 *     URL (see LOCALIZED_PATHS).
 */
const intlMiddleware = createIntlMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/' && request.cookies.get(LOCALE_COOKIE)?.value === 'ar') {
    const url = request.nextUrl.clone();
    url.pathname = '/ar';
    return NextResponse.redirect(url);
  }

  const arabicPath = pathname.match(/^\/ar(\/.*)$/)?.[1];
  if (arabicPath && !LOCALIZED_PATHS.includes(arabicPath.replace(/\/$/, '') || '/')) {
    const url = request.nextUrl.clone();
    url.pathname = arabicPath;
    return NextResponse.redirect(url);
  }

  return intlMiddleware(request);
}

export const config = {
  // Everything except API-ish paths, Next internals and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
