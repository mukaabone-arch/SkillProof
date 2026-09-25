/**
 * Real React rendering (jsdom + RTL) — same convention as
 * CandidateJobs.spec.tsx: only `fetch` (and here, `window.gtag`) is mocked,
 * lib/api.ts is the real module.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OtpLogin from './OtpLogin';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

type GtagWindow = Window & { gtag?: jest.Mock };

// AuthMessageRotator (rendered by OtpLogin) reads prefers-reduced-motion —
// jsdom has no real implementation.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
});

function mockFetchFor(isNewUser: boolean) {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/email/otp/request')) return jsonResponse(200, { message: 'OTP sent' });
    if (url.includes('/auth/email/otp/verify')) {
      return jsonResponse(200, { accessToken: 'access.tok', refreshToken: 'refresh.tok', isNewUser });
    }
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;
}

async function completeEmailFlow(onLoggedIn: jest.Mock) {
  render(<OtpLogin onLoggedIn={onLoggedIn} />);

  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'candidate@example.com' } });
  fireEvent.click(screen.getByText('Send code'));

  const otpInput = await screen.findByLabelText('Verification code');
  fireEvent.change(otpInput, { target: { value: '123456' } });
  fireEvent.click(screen.getByText('Verify and continue'));

  await waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1));
}

describe('OtpLogin — sign_up vs. login analytics', () => {
  let gtag: jest.Mock;

  beforeEach(() => {
    gtag = jest.fn();
    (window as unknown as GtagWindow).gtag = gtag;
  });

  afterEach(() => {
    delete (window as unknown as GtagWindow).gtag;
  });

  it('fires sign_up exactly once, never login, when the auth response says isNewUser: true', async () => {
    mockFetchFor(true);
    await completeEmailFlow(jest.fn());

    const signUpCalls = gtag.mock.calls.filter((c) => c[1] === 'sign_up');
    const loginCalls = gtag.mock.calls.filter((c) => c[1] === 'login');
    expect(signUpCalls).toHaveLength(1);
    expect(loginCalls).toHaveLength(0);
    expect(signUpCalls[0][2]).toEqual({ method: 'email_otp', role: 'candidate' });
  });

  it('fires login exactly once, never sign_up, when the auth response says isNewUser: false', async () => {
    mockFetchFor(false);
    await completeEmailFlow(jest.fn());

    const signUpCalls = gtag.mock.calls.filter((c) => c[1] === 'sign_up');
    const loginCalls = gtag.mock.calls.filter((c) => c[1] === 'login');
    expect(signUpCalls).toHaveLength(0);
    expect(loginCalls).toHaveLength(1);
    expect(loginCalls[0][2]).toEqual({ method: 'email_otp', role: 'candidate' });
  });

  it('no event payload contains the actual email address or any identifier key', async () => {
    mockFetchFor(true);
    await completeEmailFlow(jest.fn());

    const PII_KEYS = ['email', 'phone', 'name', 'fullName', 'userId', 'id', 'profileId'];
    for (const call of gtag.mock.calls) {
      const params = (call[2] as Record<string, unknown> | undefined) ?? {};
      expect(JSON.stringify(params)).not.toMatch(/candidate@example\.com/);
      for (const key of Object.keys(params)) {
        expect(PII_KEYS).not.toContain(key);
      }
    }
  });
});
