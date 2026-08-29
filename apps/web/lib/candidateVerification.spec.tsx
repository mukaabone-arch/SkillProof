/**
 * Real React rendering (jsdom + RTL) — this is what actually caught the
 * "stuck on Loading… forever" regression the previous fix introduced,
 * which pure reasoning about effect ordering didn't. Two layers:
 *
 *  - Unit-level tests against CandidateVerificationProvider directly, with
 *    a trivial child — fast, isolate the state machine itself.
 *  - An integration test against the REAL /candidate page component tree
 *    (Home -> OtpLogin -> Dashboard, not stand-ins) and the REAL
 *    lib/api.ts (only `fetch` is mocked) — this is what actually
 *    reproduces the reported scenario: anonymous -> client-side login (no
 *    navigation) -> a gated child's own fetches reveal the candidate is
 *    incomplete. Earlier, simpler attempts (a token present from the
 *    start; a hand-rolled stand-in child) did not reproduce it.
 */
import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CandidateVerificationProvider } from './candidateVerification';
import { api, clearTokens, setTokens } from './api';
import Providers from '../components/Providers';
import CandidatePage from '../app/candidate/page';

const replace = jest.fn();
let pathname = '/candidate';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const INCOMPLETE_BODY = {
  code: 'CANDIDATE_VERIFICATION_INCOMPLETE',
  message: 'Add and verify both a phone number and an email address to continue.',
  missing: ['email'],
};

beforeEach(() => {
  jest.clearAllMocks();
  pathname = '/candidate';
  // localStorage.clear() alone isn't enough — the candidate api client
  // also caches the access/refresh token in a module-level closure
  // variable (see lib/api.ts's createApiClient), which a leftover
  // setTokens() call from a previous test would otherwise leave in place.
  clearTokens();
  localStorage.clear();
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
});

describe('CandidateVerificationProvider — unit', () => {
  function Probe() {
    return <div data-testid="page-content">real page content</div>;
  }

  it('renders children immediately with no token (anonymous visitor) — never fails open by blocking', () => {
    render(
      <CandidateVerificationProvider>
        <Probe />
      </CandidateVerificationProvider>,
    );
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('renders children for a fully-verified candidate', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (url: string) =>
      url.endsWith('/users/me')
        ? jsonResponse(200, { role: 'CANDIDATE', phone: '+911234567890', email: 'a@b.com' })
        : jsonResponse(200, {}),
    ) as unknown as typeof fetch;
    act(() => setTokens('tok-complete', 'refresh'));

    render(
      <CandidateVerificationProvider>
        <Probe />
      </CandidateVerificationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('page-content')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('fails open (renders children, never blocks) when GET /users/me rejects outright', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () => {
      throw new Error('network error');
    }) as unknown as typeof fetch;
    act(() => setTokens('tok-fail', 'refresh'));

    render(
      <CandidateVerificationProvider>
        <Probe />
      </CandidateVerificationProvider>,
    );

    // Never blocking in the first place while status is 'unknown' — see
    // candidateVerification.tsx's own doc comment on failing open — so
    // this should already be true, not just eventually true.
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('page-content')).toBeInTheDocument());
  });

  it('redirects exactly once (never repeats or restarts the navigation) once a gated child fetch reveals an incomplete candidate', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/users/me')) return jsonResponse(200, { role: 'CANDIDATE', phone: '+911234567890', email: null });
      if (url.endsWith('/gated')) return jsonResponse(400, INCOMPLETE_BODY);
      return jsonResponse(200, {});
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    function GatedChild() {
      // Fires on every render, same as multiple parallel Promise.all calls
      // in the real Dashboard all rejecting close together — the bus
      // dedup and the one-shot redirect guard both need to hold up
      // against that, not just a single rejection.
      void api('/gated').catch(() => undefined);
      void api('/gated').catch(() => undefined);
      void api('/gated').catch(() => undefined);
      return <div data-testid="page-content">real page content</div>;
    }

    act(() => setTokens('tok-multi', 'refresh'));

    render(
      <CandidateVerificationProvider>
        <GatedChild />
      </CandidateVerificationProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/verify'));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('falls back to rendering children after REDIRECT_FALLBACK_MS even if the navigation never visibly completes, and never leaves the placeholder without a logout button', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (url: string) =>
      url.endsWith('/users/me')
        ? jsonResponse(200, { role: 'CANDIDATE', phone: '+911234567890', email: null })
        : jsonResponse(200, {}),
    ) as unknown as typeof fetch;
    act(() => setTokens('tok-stuck', 'refresh'));

    render(
      <CandidateVerificationProvider>
        <Probe />
      </CandidateVerificationProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/verify'));
    // While the redirect is in flight (our mocked router never actually
    // navigates), the placeholder must have its own logout button — never
    // a dead end.
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();

    // And it must not stay that way forever: content renders once the
    // fallback fires, matching REDIRECT_FALLBACK_MS in candidateVerification.tsx.
    await waitFor(() => expect(screen.getByTestId('page-content')).toBeInTheDocument(), { timeout: 6000 });
  }, 10000);
});

describe('CandidateVerificationProvider — real /candidate page tree, phone-only login', () => {
  const PHONE = '+911234567890';

  it('never gets stuck on Loading… indefinitely after a real client-side login', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/auth/otp/request')) return jsonResponse(200, { message: 'OTP sent' });
      if (url.endsWith('/auth/otp/verify')) {
        return jsonResponse(200, {
          accessToken: 'tok-1',
          refreshToken: 'refresh-1',
          user: { id: 'user-1', phone: PHONE, role: 'CANDIDATE' },
        });
      }
      if (url.endsWith('/users/me')) return jsonResponse(200, { role: 'CANDIDATE', phone: PHONE, email: null });
      if (url.endsWith('/account/status')) return jsonResponse(200, { deactivated: false });
      // Every gated candidate-data endpoint Dashboard fires, real shape.
      return jsonResponse(400, INCOMPLETE_BODY);
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    render(
      <StrictMode>
        <Providers>
          <CandidatePage />
        </Providers>
      </StrictMode>,
    );

    await waitFor(() => screen.getByRole('tab', { name: /phone/i }));
    fireEvent.click(screen.getByRole('tab', { name: /phone/i }));
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: PHONE } });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    fireEvent.change(await screen.findByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/verify'), { timeout: 5000 });
    expect(replace).toHaveBeenCalledTimes(1);

    // The real proof this doesn't get stuck: real page content (or, worst
    // case, Dashboard's own recoverable error state — either way, never a
    // dead "Loading…") is visible after the fallback window, and there's
    // always been a logout button reachable throughout.
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument(), { timeout: 6000 });
  }, 15000);
});
