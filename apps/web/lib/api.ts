/**
 * Thin API client with automatic token refresh.
 *
 * Access token (15 min) is sent as Bearer. When a request comes back 401,
 * we transparently call /auth/refresh with the stored refresh token (30 days),
 * save the new pair, and retry the original request once. The user never sees
 * the "Invalid or expired token" wall unless the refresh token itself is dead.
 *
 * TODO before production: move both tokens to httpOnly cookies via a Next.js
 * route handler proxy, to remove them from JS-readable storage (XSS defense).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string | null, refresh?: string | null) {
  accessToken = access;
  if (refresh !== undefined) refreshToken = refresh;
  if (typeof window !== 'undefined') {
    if (access) localStorage.setItem('sp_token', access);
    else localStorage.removeItem('sp_token');
    if (refresh !== undefined) {
      if (refresh) localStorage.setItem('sp_refresh', refresh);
      else localStorage.removeItem('sp_refresh');
    }
  }
}

// Back-compat: existing callers use setToken(access)
export function setToken(t: string | null) {
  setTokens(t);
}

export function getToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== 'undefined') accessToken = localStorage.getItem('sp_token');
  return accessToken;
}

function getRefresh(): string | null {
  if (refreshToken) return refreshToken;
  if (typeof window !== 'undefined') refreshToken = localStorage.getItem('sp_refresh');
  return refreshToken;
}

export function clearTokens() {
  setTokens(null, null);
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
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...options.headers,
    },
  });
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, options);

  // Access token expired → refresh once and retry the original request.
  if (res.status === 401 && (await tryRefresh())) {
    res = await rawFetch(path, options);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
  return res.json();
}
