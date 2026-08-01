/**
 * Base URL of the deployed web app — used to build absolute links in
 * notification emails (a candidate's inbox has no notion of the API's own
 * origin, so every CTA needs a real, absolute URL to the web app). Mirrors
 * the mobile app's `WEB_BASE_URL` (see skillproof-mobile's ApiConfig.webBaseUrl),
 * same name, same purpose — a link that only makes sense opened in a browser.
 *
 * No trailing slash — callers append a leading-slash path directly
 * (`${WEB_BASE_URL}/interviews`). Defaults to the local Next.js dev server
 * port so `yarn start:dev` produces working links with no .env changes.
 */
export const WEB_BASE_URL = (process.env.WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
