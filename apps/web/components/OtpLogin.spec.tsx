/**
 * Real React rendering (jsdom + RTL) — same convention as
 * CandidateJobs.spec.tsx: only `fetch` (and here, `window.gtag`) is mocked,
 * lib/api.ts is the real module.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { clearTokens, setTokens, employerApi } from '@/lib/api';
import OtpLogin from './OtpLogin';
import EmployerOtpLogin from './EmployerOtpLogin';

beforeEach(() => {
  // BetaPromoScroll (rendered by OtpLogin) reads auth tokens on mount —
  // a token left over from a previous test's completed login flow would
  // hide it in a later test that never signed in.
  clearTokens();
  employerApi.clearTokens();
  localStorage.clear();
});

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

describe('OtpLogin — beta promo ribbon', () => {
  it('renders BetaPromoScroll for an anonymous visitor', () => {
    render(<OtpLogin onLoggedIn={jest.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Candidates: Be among the first to prove your AI skills and apply for jobs',
    );
  });

  it('renders nothing when a candidate token is present', () => {
    setTokens('access-token', 'refresh-token');
    render(<OtpLogin onLoggedIn={jest.fn()} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders nothing when an employer token is present', () => {
    employerApi.setTokens('emp-access-token', 'emp-refresh-token');
    render(<OtpLogin onLoggedIn={jest.fn()} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('OtpLogin — AuthPitch (replaces AuthMessageRotator)', () => {
  it('renders the headline and both proof points', () => {
    render(<OtpLogin onLoggedIn={jest.fn()} />);
    // Both the visual and inline AuthPitch variants render (CSS, not JS,
    // decides which is visible at a given width — see AuthPitch.tsx's own
    // doc comment), so headline/proof-point text legitimately appears
    // twice in this jsdom render; getAllByText rather than getByText.
    expect(screen.getAllByText('Prove your skills. Get matched to jobs that want them.').length).toBe(2);
    expect(
      screen.getAllByText('One skill, one level — Prompt Engineering, Practitioner — not a vague "AI skills" checkbox.')
        .length,
    ).toBe(2);
    expect(
      screen.getAllByText('Nothing reaches employers until you approve it — visibility is off by default.').length,
    ).toBe(2);
    // The middle point ("Earned under assessment — never self-reported")
    // was cut — these two were always the load-bearing pair.
    expect(screen.queryByText('Earned under assessment — never self-reported.')).not.toBeInTheDocument();
  });

  it('renders the badge specimen with no name or person-identifying content', () => {
    render(<OtpLogin onLoggedIn={jest.fn()} />);
    expect(screen.getByText('Prompt Engineering — Practitioner')).toBeInTheDocument();
    expect(screen.getByText('Example badge')).toBeInTheDocument();
    // Nothing resembling the real verify page's name/date/ID fields.
    expect(screen.queryByText(/Verification ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Issued/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Valid until/i)).not.toBeInTheDocument();
  });

  it('no longer renders AuthMessageRotator or its candidate messages', () => {
    render(<OtpLogin onLoggedIn={jest.fn()} />);
    expect(screen.queryByText('Apply in minutes, not hours')).not.toBeInTheDocument();
    expect(screen.queryByText('Proof, not promises')).not.toBeInTheDocument();
  });

  it('the sign-in card still renders every existing control', () => {
    render(<OtpLogin onLoggedIn={jest.fn()} />);
    expect(screen.getByRole('tab', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Phone' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText('Send code')).toBeInTheDocument();
    expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
    expect(screen.getByText('Sign in with GitHub')).toBeInTheDocument();
  });
});

describe('EmployerOtpLogin — still on AuthMessageRotator (regression check)', () => {
  it('still renders the rotator with its own employer messages, not AuthPitch', () => {
    render(<EmployerOtpLogin onLoggedIn={jest.fn()} />);
    expect(screen.getByText('Hire on evidence, not claims')).toBeInTheDocument();
    expect(
      screen.queryByText('Prove your skills. Get matched to jobs that want them.'),
    ).not.toBeInTheDocument();
  });
});
