'use client';

/**
 * Shared handler for /auth/google/callback and /auth/github/callback.
 * Verifies CSRF `state`, exchanges `code` for our own JWT pair via
 * POST /auth/:provider, stores it with the candidate-scoped setTokens, and
 * bounces to the dashboard. See docs/oauth-setup.md for the full flow.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setTokens } from '@/lib/api';
import { consumeStoredState, redirectUriFor, PROVIDER_LABEL, type OAuthProviderId } from '@/lib/oauth';
import Logo from './Logo';

interface Props {
  provider: OAuthProviderId;
}

export default function OAuthCallback({ provider }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // Guards against React StrictMode's dev-only double-invoke of effects —
  // without it, the second invocation would find consumeStoredState()
  // already emptied by the first and wrongly report an expired session.
  // Production (no StrictMode double-invoke) only ever runs this once anyway.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const label = PROVIDER_LABEL[provider];

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
        const res = await api<{ accessToken: string; refreshToken: string }>(`/auth/${provider}`, {
          method: 'POST',
          body: JSON.stringify({ code, redirectUri: redirectUriFor(provider) }),
        });
        setTokens(res.accessToken, res.refreshToken);
        router.replace('/');
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
            <button onClick={() => router.replace('/')}>Back to login</button>
          </>
        ) : (
          <p>Signing you in with {PROVIDER_LABEL[provider]}…</p>
        )}
      </div>
    </main>
  );
}
