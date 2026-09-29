/**
 * Real React rendering (jsdom + RTL) — same convention as OtpLogin.spec.tsx:
 * only `fetch` and next/navigation are mocked, lib/api.ts is the real module.
 */
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import WebHandoff from './WebHandoff';
import { clearTokens, getToken } from '@/lib/api';

const replace = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  search = '';
  // localStorage.clear() alone isn't enough — lib/api.ts's candidate client
  // also caches the token in a module-level closure variable (see
  // lib/candidateVerification.spec.tsx's identical note).
  clearTokens();
  localStorage.clear();
});

describe('WebHandoff — mobile → web session bridge', () => {
  it('redeems a valid code and lands on a safe next path, signed in', async () => {
    search = 'code=abc123&next=%2Fresume';
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () =>
      jsonResponse(200, { accessToken: 'access.tok', refreshToken: 'refresh.tok' }),
    ) as unknown as typeof fetch;

    render(<WebHandoff />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/resume'));
    expect(getToken()).toBe('access.tok');
  });

  it('never follows an absolute-URL next, even on a successful redeem', async () => {
    search = 'code=abc123&next=https%3A%2F%2Fevil.com';
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () =>
      jsonResponse(200, { accessToken: 'access.tok', refreshToken: 'refresh.tok' }),
    ) as unknown as typeof fetch;

    render(<WebHandoff />);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith('/candidate');
    expect(replace.mock.calls.some((c) => String(c[0]).includes('evil.com'))).toBe(false);
  });

  it('never follows a protocol-relative next', async () => {
    search = 'code=abc123&next=%2F%2Fevil.com';
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () =>
      jsonResponse(200, { accessToken: 'access.tok', refreshToken: 'refresh.tok' }),
    ) as unknown as typeof fetch;

    render(<WebHandoff />);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith('/candidate');
  });

  it('a bad code lands on /candidate with the destination preserved, and sets no session', async () => {
    search = 'code=bogus&next=%2Fresume';
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () =>
      jsonResponse(401, { message: 'Invalid or expired code' }),
    ) as unknown as typeof fetch;

    render(<WebHandoff />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/candidate?returnTo=%2Fresume'));
    expect(getToken()).toBeNull();
  });

  it('no code at all goes straight to /candidate without calling the API', async () => {
    search = 'next=%2Fresume';
    const fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    render(<WebHandoff />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/candidate?returnTo=%2Fresume'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
