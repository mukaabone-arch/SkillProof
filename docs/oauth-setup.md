# Google & GitHub OAuth setup

Backend endpoints (`apps/api/src/modules/auth`) do a server-side authorization-code
exchange for both providers and issue the same JWT access/refresh pair as
`/auth/otp/verify`. Web uses the standard redirect flow; the mobile app runs
each provider's native SDK (PKCE) and forwards the resulting `code` +
`codeVerifier` to our API, which finishes the exchange with the client secret.

## Env vars (`apps/api/.env`)

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

## Env vars (`apps/web/.env`)

The web app only ever handles the client ID, never the secret — it's the
public half of the OAuth client and is meant to ship to the browser (see
`apps/web/lib/oauth.ts`).

```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
NEXT_PUBLIC_GITHUB_CLIENT_ID=
```

These should be the **same client IDs** as `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID`
above — the web app builds the authorize URL with them, and the API later
completes the exchange (with the matching secret) for the code that comes
back.

## Google Cloud Console

1. APIs & Services → Credentials → Create Credentials → OAuth client ID.
2. Application type:
   - **Web application** for the web app's redirect flow.
   - **Android** / **iOS** OAuth client (separate client IDs, one per platform)
     for the mobile app's native SDK — these don't take a client secret from
     the device, but the API still needs *a* web/server client secret to
     complete the code exchange server-side (Google's "installed app" client
     type also issues one; use that client's ID/secret in `GOOGLE_CLIENT_ID`/
     `GOOGLE_CLIENT_SECRET` for the mobile-originated exchange).
3. Authorized redirect URIs (web client):
   - `http://localhost:3000/auth/google/callback` (local dev)
   - `https://<web-prod-domain>/auth/google/callback` (production)
4. Scopes requested during the auth-code request: `openid email profile`
   (default OpenID Connect scopes — this is what makes `email_verified`
   available from the userinfo endpoint our API calls).
5. OAuth consent screen: add the production domain, and add test users if the
   app is still in "Testing" publishing status.

## GitHub

1. Settings → Developer settings → OAuth Apps → New OAuth App (one app per
   environment is simplest — separate dev/prod client id+secret).
2. Homepage URL: your web app's URL.
3. Authorization callback URL:
   - `http://localhost:3000/auth/github/callback` (local dev)
   - `https://<web-prod-domain>/auth/github/callback` (production)
4. Scopes requested in the authorize URL: **`read:user user:email`**.
   `read:user` alone is not enough — GitHub only returns a verified/primary
   email via `GET /user/emails`, which needs `user:email`. Without it,
   `emailVerified` will always come back `false` and the account will never
   auto-link, only ever create a fresh user.
5. GitHub OAuth Apps don't support PKCE natively the way Google/mobile SDKs
   do — for the mobile app, either use GitHub's device flow or route GitHub
   sign-in through an in-app browser tab performing the standard redirect
   flow, then forward the resulting `code` to `POST /auth/github` (omit
   `codeVerifier`).

## API endpoints this wires up

- `POST /auth/google` `{ code, redirectUri, codeVerifier? }` → sign in or sign up.
- `POST /auth/github` `{ code, redirectUri, codeVerifier? }` → sign in or sign up.
- `POST /auth/connect/:provider` (`google`|`github`, Bearer auth required)
  `{ code, redirectUri, codeVerifier? }` → link a provider to the
  already-logged-in account, regardless of email match.
- `POST /auth/otp/*` — unchanged, phone flow still works exactly as before.

`redirectUri` must exactly match whatever redirect URI was used to obtain
`code` in the first place (OAuth spec requirement) — it does not need to be
one of the URIs above if the mobile app used a custom scheme, as long as that
scheme is also registered in each provider's console.
