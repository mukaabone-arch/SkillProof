'use client';

/**
 * Shared handler for /auth/google/callback and /auth/github/callback —
 * for BOTH the candidate app and the employer portal, since both reuse the
 * same registered redirect_uri. Verifies CSRF `state`, then reads back which
 * portal kicked off the flow (stashed by startOAuthLogin, see
 * consumeStoredPortal) to decide: exchange `code` via POST /auth/:provider
 * and store it with the candidate-scoped setTokens, or via
 * POST /auth/employer/:provider and store it with employerApi's
 * sp_emp_token/sp_emp_refresh instead. See docs/oauth-setup.md for the full
 * flow.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, employerApi, setTokens } from '@/lib/api';
import { consumeStoredPortal, consumeStoredState, redirectUriFor, PROVIDER_LABEL, type OAuthProviderId } from '@/lib/oauth';
import Logo from './Logo';

interface Props {
  provider: OAuthProviderId;
}

export default function OAuthCallback({ provider }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [backHref, setBackHref] = useState<'/' | '/employer'>('/');
  // Guards against React StrictMode's dev-only double-invoke of effects —
  // without it, the second invocation would find consumeStoredState()
  // already emptied by the first and wrongly report an expired session.
  // Production (no StrictMode double-invoke) only ever runs this once anyway.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const label = PROVIDER_LABEL[provider];
    // Which login page kicked off this flow — read (and cleared) once,
    // up front, so every early-return below can still route back correctly.
    const portal = consumeStoredPortal(provider);
    const backHref = portal === 'employer' ? '/employer' : '/';
    setBackHref(backHref);

    // The provider itself reports a problem (most commonly the user hit
    // "Cancel" on the consent screen) — this is expected, everyday traffic,
    // not a bug, so it gets a calm, specific message rather than falling
    // through to the generic error/exchange path below.
    const oauthError = searchParams.get('error');
    if (oauthError) {
      setError(
        oauthError === 'access_denied'
          ? `You cancelled ${label} sign-in. You can try again, or use your phone number instead.`
          : `${label} sign-in failed (${oauthError}). Please try again.`,
      );
      return;
    }

    const code = searchParams.get('code');
    const returnedState = searchParams.get('state');
    const expectedState = consumeStoredState(provider);

    if (!code) {
      setError(`${label} did not return an authorization code. Please try again.`);
      return;
    }

    // CSRF check: the state we generated and stashed before redirecting must
    // come back byte-for-byte. Missing (nothing stored — direct hit on this
    // URL, or already consumed by an earlier attempt) or mismatched (forged
    // callback) both fail closed: never proceed to the token exchange.
    if (!expectedState || !returnedState || returnedState !== expectedState) {
      setError('Your sign-in session expired or could not be verified. Please try again.');
      return;
    }

    (async () => {
      try {
        const body = JSON.stringify({ code, redirectUri: redirectUriFor(provider) });
        if (portal === 'employer') {
          const res = await employerApi.api<{ accessToken: string; refreshToken: string }>(
            `/auth/employer/${provider}`,
            { method: 'POST', body },
          );
          employerApi.setTokens(res.accessToken, res.refreshToken);
        } else {
          const res = await api<{ accessToken: string; refreshToken: string }>(`/auth/${provider}`, {
            method: 'POST',
            body,
          });
          setTokens(res.accessToken, res.refreshToken);
        }
        router.replace(backHref);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [provider, router, searchParams]);

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand-lockup-hero">
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">SkillProof</span>
        </div>
        {error ? (
          <>
            <p className="error">{error}</p>
            <button onClick={() => router.replace(backHref)}>Back to login</button>
          </>
        ) : (
          <p>Signing you in with {PROVIDER_LABEL[provider]}…</p>
        )}
      </div>
    </main>
  );
}
