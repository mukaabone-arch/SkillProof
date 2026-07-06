# Token Refresh — install instructions

Fixes the "Invalid or expired token" wall. Adds a 30-day refresh token that
silently renews your 15-min access token in the background.

## Files in this patch
NEW    apps/api/prisma/refresh-token.prisma.snippet   (paste into schema, see step 1)
EDIT   apps/api/src/modules/auth/auth.service.ts      (issue/rotate/revoke refresh tokens)
EDIT   apps/api/src/modules/auth/auth.controller.ts   (+ /auth/refresh, /auth/logout)
EDIT   apps/web/lib/api.ts                             (auto-refresh on 401, store both tokens)
EDIT   apps/web/app/page.tsx                           (save refreshToken on login)

## Install steps

1. Add the RefreshToken model to your Prisma schema.
   Open apps/api/prisma/refresh-token.prisma.snippet, copy the `model RefreshToken {...}`
   block, and paste it at the END of apps/api/prisma/schema.prisma.

   THEN add one line to your existing `model User` — inside its body, next to
   the other relations (profile / attempts / badges), add:

       refreshTokens RefreshToken[]

2. Copy the 4 EDIT files into place (same paths), overwriting the old ones.

3. Create + apply the migration (from apps/api):

       npx prisma migrate dev --name add_refresh_tokens

   This creates the RefreshToken table and regenerates the Prisma client.

4. Both dev servers hot-reload. If the API doesn't pick up the new Prisma
   client, restart `npm run start:dev`.

## Test it
- Log in normally at http://localhost:3000 (you'll now get a refresh token too —
  check localStorage: keys `sp_token` AND `sp_refresh`).
- To prove refresh works without waiting 15 min: open DevTools → Application →
  Local Storage, delete only `sp_token` (leave `sp_refresh`), then click Start on
  an assessment. The request 401s, the client auto-refreshes, and the assessment
  loads anyway — no "Invalid or expired token". A new `sp_token` appears.
- Logout (when you wire a button): call api('/auth/logout', {method:'POST',
  body: JSON.stringify({ refreshToken: localStorage.getItem('sp_refresh') })})
  then clearTokens().
