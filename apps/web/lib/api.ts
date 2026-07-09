/**
 * Thin API client with automatic token refresh.
 *
 * Access token (15 min) is sent as Bearer. When a request comes back 401,
 * we transparently call /auth/refresh with the stored refresh token (30 days),
 * save the new pair, and retry the original request once. The user never sees
 * the "Invalid or expired token" wall unless the refresh token itself is dead.
 *
 * Scoped clients: the candidate app, the employer portal, and any future
 * admin-only surface can all be logged into simultaneously in the same
 * browser, so each portal's tokens live under their own localStorage keys
 * instead of one shared pair — logging into the employer portal must not
 * clobber a candidate session open in another tab, and vice versa.
 *
 * TODO before production: move both tokens to httpOnly cookies via a Next.js
 * route handler proxy, to remove them from JS-readable storage (XSS defense).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Thrown by api() on a non-ok response — `body` is the parsed JSON error payload, if any. */
export interface ApiError extends Error {
  body?: unknown;
}

interface ScopeKeys {
  access: string;
  refresh: string;
}

function createApiClient({ access: ACCESS_KEY, refresh: REFRESH_KEY }: ScopeKeys) {
  let accessToken: string | null = null;
  let refreshToken: string | null = null;

  function setTokens(access: string | null, refresh?: string | null) {
    accessToken = access;
    if (refresh !== undefined) refreshToken = refresh;
    if (typeof window !== 'undefined') {
      if (access) localStorage.setItem(ACCESS_KEY, access);
      else localStorage.removeItem(ACCESS_KEY);
      if (refresh !== undefined) {
        if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
        else localStorage.removeItem(REFRESH_KEY);
      }
    }
  }

  // Back-compat: existing callers use setToken(access)
  function setToken(t: string | null) {
    setTokens(t);
  }

  function getToken(): string | null {
    if (accessToken) return accessToken;
    if (typeof window !== 'undefined') accessToken = localStorage.getItem(ACCESS_KEY);
    return accessToken;
  }

  function getRefresh(): string | null {
    if (refreshToken) return refreshToken;
    if (typeof window !== 'undefined') refreshToken = localStorage.getItem(REFRESH_KEY);
    return refreshToken;
  }

  function clearTokens() {
    setTokens(null, null);
  }

  /** Revokes the refresh token server-side, then clears local storage. */
  async function logout(): Promise<void> {
    const rt = getRefresh();
    if (rt) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      }).catch(() => undefined);
    }
    clearTokens();
  }

  async function tryRefresh(): Promise<boolean> {
    const rt = getRefresh();
    if (!rt) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  async function rawFetch(path: string, options: RequestInit): Promise<Response> {
    const t = getToken();
    // FormData bodies (file uploads) need the browser to set its own multipart
    // boundary — an explicit Content-Type header here would break that.
    const isFormData = options.body instanceof FormData;
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...options.headers,
      },
    });
  }

  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    let res = await rawFetch(path, options);

    // Access token expired → refresh once and retry the original request.
    if (res.status === 401 && (await tryRefresh())) {
      res = await rawFetch(path, options);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // Some endpoints (e.g. bulk import) return structured detail beyond a
      // single message — stash the raw body so callers can read it if needed.
      const err = new Error(body.message ?? `Request failed: ${res.status}`) as ApiError;
      err.body = body;
      throw err;
    }
    return res.json();
  }

  /**
   * Same auth/refresh handling as api(), but for binary responses (PDF
   * downloads) that can't go through res.json(). A failed request still
   * comes back as JSON from Nest's exception filter, so the error path is
   * unchanged from api()'s.
   */
  async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
    let res = await rawFetch(path, options);

    if (res.status === 401 && (await tryRefresh())) {
      res = await rawFetch(path, options);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.message ?? `Request failed: ${res.status}`) as ApiError;
      err.body = body;
      throw err;
    }
    return res.blob();
  }

  return { api, apiBlob, setTokens, setToken, getToken, clearTokens, logout };
}

/** Candidate app (and any other main-site page) — unchanged storage keys. */
const candidateClient = createApiClient({ access: 'sp_token', refresh: 'sp_refresh' });
export const { api, apiBlob, setTokens, setToken, getToken, clearTokens, logout } = candidateClient;

/** Employer portal (/employer) — separate keys so it never clobbers a candidate session. */
export const employerApi = createApiClient({ access: 'sp_emp_token', refresh: 'sp_emp_refresh' });
