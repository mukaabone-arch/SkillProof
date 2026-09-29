'use client';

/**
 * Mobile → web session bridge. The Flutter app's JWT lives in
 * flutter_secure_storage, invisible to a browser — this page is how an
 * `openInBrowser` hand-off from the app to a page that requires auth
 * (assessments, resume, profile) lands the candidate already signed in
 * instead of at a login wall.
 *
 * It redeems the short-lived, single-use `code` the app minted (POST
 * /auth/web-session) via POST /auth/web-session/redeem for a normal token
 * pair, stores it exactly like any other sign-in (setTokens — this app
 * keeps tokens in localStorage, not cookies, so "set the session" happens
 * here client-side rather than via a Set-Cookie header on a server route),
 * then continues to `next`. The JWT itself never appears in a URL — only
 * the exchange code does, and it's single-use/60s, which is what makes that
 * acceptable.
 *
 * `next` is validated with isSafeReturnTo before being followed anywhere:
 * this route mints a session, so an unvalidated redirect target here would
 * be an open redirect *with a session attached*. A failure (bad, expired,
 * or already-used code) never says which — it lands on the ordinary
 * candidate sign-in with the destination preserved, indistinguishable from
 * a visitor who simply was never signed in.
 */
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setTokens } from '@/lib/api';
import { isSafeReturnTo } from '@/lib/returnTo';
import BrandLockup from './BrandLockup';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function WebHandoff() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Guards against React StrictMode's dev-only double-invoke of effects —
  // without it, the second invocation would try to redeem an
  // already-consumed code and fall through to the failure path. Same
  // reasoning as OAuthCallback's identical guard.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get('code');
    const rawNext = searchParams.get('next');
    const safeNext = isSafeReturnTo(rawNext) ? rawNext : '/candidate';

    const toSignIn = () =>
      router.replace(safeNext === '/candidate' ? '/candidate' : `/candidate?returnTo=${encodeURIComponent(safeNext)}`);

    if (!code) {
      toSignIn();
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/web-session/redeem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) throw new Error('redeem failed');
        const data = (await res.json()) as { accessToken: string; refreshToken: string };
        setTokens(data.accessToken, data.refreshToken);
        router.replace(safeNext);
      } catch {
        toSignIn();
      }
    })();
  }, [router, searchParams]);

  return (
    <main className="auth auth-gradient">
      <div className="auth-card">
        <BrandLockup variant="hero" />
        <p className="auth-subtitle">Signing you in…</p>
      </div>
    </main>
  );
}
