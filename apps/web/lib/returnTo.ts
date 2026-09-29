/**
 * Only ever follow a same-origin relative path — never an absolute/
 * protocol-relative URL from the query string. Also used to validate
 * `next` on /auth/handoff, the mobile→web session-bridge route that mints a
 * session — an unvalidated redirect target there is an open redirect *with
 * a session attached*, so this is deliberately stricter than "starts with a
 * single slash":
 *  - no leading `//` (a valid absolute URL to a browser — the classic
 *    protocol-relative bypass)
 *  - no backslash anywhere (some browsers normalize `\` to `/`, so
 *    `/\evil.com` would otherwise slip through as a lone leading slash)
 *  - `new URL(path, origin)` must resolve to the SAME origin — the
 *    authoritative check; the two above are cheap pre-filters for the
 *    common cases, this one is what actually can't be bypassed by a
 *    browser-specific normalization quirk we haven't thought of.
 */
export function isSafeReturnTo(path: string | null): path is string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return false;
  if (typeof window === 'undefined') return true;
  try {
    return new URL(path, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}
