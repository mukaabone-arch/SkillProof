# Regional deployments (India, UAE, later Saudi Arabia)

One codebase, one build per region. Each region is its own Amplify app (web)
and its own API + database in that region's AWS account/region, so accounts
and data never leave the region. Nothing is shared between regions; there is
no redirect between sites, only an explicit "Change region" link (to add).

## Web (Amplify) environment variables per region

| Variable | India (myambii.com) | UAE (me-central-1) |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://www.myambii.com` (default) | the UAE site's origin, e.g. `https://www.myambii.ae` |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `en` (default) — Arabic at `/ar` | `ar` — English at `/en` |
| `NEXT_PUBLIC_COOKIEYES_ID` | current ID (default) | the UAE domain's CookieYes ID (`''` turns the banner off) |
| API base URL (existing setting) | India API | UAE API |

`NEXT_PUBLIC_*` values are baked in at build time: changing one needs a rebuild.

## How locales behave

- `as-needed` prefixes: the default locale is unprefixed, the other one is
  prefixed (`/ar/...` in India, `/en/...` in the UAE).
- Only paths in `LOCALIZED_PATHS` (apps/web/i18n/routing.ts) have Arabic.
  An Arabic URL for any other path is redirected to its English URL
  (middleware.ts), so a visitor never sees English copy in an RTL shell.
- No Accept-Language or geo detection. The visitor picks a language with the
  switcher; the `NEXT_LOCALE` cookie remembers it for `/`.

## API per region (to do when the UAE stack is created)

- Web base URL used in email links (OTP, notifications).
- Google / Apple sign-in redirect URIs registered for the regional domain.
- Legal pages (privacy, terms) reviewed for the region.

## Adding Saudi Arabia later

Another Amplify app + API stack with its own values in the table above. No
code branch. Confirm data-localisation requirements with compliance advice
first.
