/**
 * Client-side half of the OAuth authorization-code flow. The server-side
 * exchange (code → provider token → profile → our own JWT pair) lives in
 * apps/api/src/modules/auth/oauth — this only builds the authorize
 * redirect and guards the callback with CSRF `state`.
 *
 * Client IDs are NEXT_PUBLIC_ (shipped to the browser by design — the OAuth
 * spec treats them as public). Client secrets never leave the API; see
 * docs/oauth-setup.md.
 */

export type OAuthProviderId = 'google' | 'github';

interface OAuthProviderConfig {
  authorizeUrl: string;
  /** openid email profile (Google) / read:user user:email (GitHub) — see docs/oauth-setup.md for why each scope is needed. */
  scope: string;
  clientId: string | undefined;
  /** Provider-specific authorize params beyond the common set (client_id/redirect_uri/response_type/scope/state). */
  extraParams?: Record<string, string>;
}

const PROVIDERS: Record<OAuthProviderId, OAuthProviderConfig> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
    clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    // Without this, Google silently re-authorizes whichever Google account
    // is already signed in to the browser and skips the account chooser —
    // fine for a returning user, but it means there's no way to switch
    // accounts to test sign-up or the auto-link-by-email flow without
    // signing out of Google entirely first. `select_account` forces the
    // chooser every time, even with one signed-in account.
    // GitHub has no equivalent `prompt` param on its authorize endpoint —
    // it always shows its own account/session picker when more than one
    // GitHub session exists, but offers no way to force that picker when
    // only one does, so switching test accounts there does require signing
    // out of GitHub first.
    extraParams: { prompt: 'select_account' },
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    scope: 'read:user user:email',
    clientId: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
  },
};

export const PROVIDER_LABEL: Record<OAuthProviderId, string> = {
  google: 'Google',
  github: 'GitHub',
};

const STATE_KEY_PREFIX = 'sp_oauth_state_';

/** Must exactly match what's registered in each provider's console (see docs/oauth-setup.md) and what the callback route posts back to the API. */
export function redirectUriFor(provider: OAuthProviderId): string {
  return `${window.location.origin}/auth/${provider}/callback`;
}

/** Cryptographically random, URL-safe — used once as the CSRF `state` param. */
function generateState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Kicks off the redirect flow for `provider`: stashes a fresh CSRF `state`
 * in sessionStorage (survives the round trip to the provider and back,
 * scoped to this tab) and navigates to the provider's authorize URL.
 */
export function startOAuthLogin(provider: OAuthProviderId): void {
  const config = PROVIDERS[provider];
  if (!config.clientId) {
    throw new Error(`${PROVIDER_LABEL[provider]} sign-in is not configured.`);
  }

  const state = generateState();
  sessionStorage.setItem(STATE_KEY_PREFIX + provider, state);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUriFor(provider),
    response_type: 'code',
    scope: config.scope,
    state,
    ...config.extraParams,
  });
  window.location.assign(`${config.authorizeUrl}?${params.toString()}`);
}

/**
 * Reads and deletes the state stashed by [startOAuthLogin] — single-use, so
 * a replayed or duplicated callback can't be re-verified against a state
 * that's already been consumed. Returns null if nothing was stored (e.g.
 * the callback was hit directly, not via our redirect).
 */
export function consumeStoredState(provider: OAuthProviderId): string | null {
  const key = STATE_KEY_PREFIX + provider;
  const value = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  return value;
}
