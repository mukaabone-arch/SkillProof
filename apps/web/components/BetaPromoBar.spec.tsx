/**
 * Real React rendering (jsdom + RTL), same convention as
 * lib/candidateVerification.spec.tsx: the real lib/api.ts token storage
 * (localStorage), only next/navigation's usePathname mocked with a
 * mutable module-level variable.
 *
 * IST vs UTC note (for the boundary tests below): IST is UTC+5:30, always
 * AHEAD of UTC — so a real instant is never "still the 30th in IST but
 * already the 1st in UTC" (that direction is physically impossible; IST's
 * calendar date rolls over first, not last). The failure this guards
 * against runs the other way: a moment that UTC would still happily label
 * "November 30" (e.g. 20:00 UTC) can already be past the correct IST
 * cutoff (23:59:59 IST = 18:29:59 UTC) — see the discriminating case below.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import BetaPromoBar from './BetaPromoBar';
import { setTokens, clearTokens, employerApi } from '@/lib/api';
import { BETA_FREE_UNTIL } from '@/lib/betaPromo';

let pathname = '/';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

beforeEach(() => {
  pathname = '/';
  clearTokens();
  employerApi.clearTokens();
  localStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('BetaPromoBar — date cutoff', () => {
  it('renders comfortably before the cutoff', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00+05:30'));
    render(<BetaPromoBar stacked />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('renders in the last second before the cutoff instant', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-30T23:59:59+05:30'));
    render(<BetaPromoBar stacked />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('returns null one second after the cutoff instant', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-01T00:00:00+05:30'));
    const { container } = render(<BetaPromoBar stacked />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null well after the cutoff', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-15T00:00:00+05:30'));
    const { container } = render(<BetaPromoBar stacked />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the IST cutoff, not a UTC one: 20:00 UTC on 30 Nov is still labelled "the 30th" in UTC, but IST (UTC+5:30) is already past the 23:59:59 IST cutoff (18:29:59 UTC) by then', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-30T20:00:00Z'));
    const { container } = render(<BetaPromoBar stacked />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders for an IST evening moment on the 30th, even though the equivalent UTC clock reading is earlier that same UTC day', () => {
    // 2026-11-30T15:00:00Z = 2026-11-30T20:30:00+05:30 — well within the window.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-30T15:00:00Z'));
    render(<BetaPromoBar stacked />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});

describe('BetaPromoBar — copy', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00+05:30'));
  });

  it('matches the required copy exactly, with the date read from BETA_FREE_UNTIL', () => {
    render(<BetaPromoBar stacked />);
    expect(BETA_FREE_UNTIL.toISOString()).toBe('2026-11-30T18:29:59.000Z');
    expect(screen.getByRole('note')).toHaveTextContent(
      "Candidates: free while we're in beta — until 30 November",
    );
  });
});

describe('BetaPromoBar — route gating', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00+05:30'));
  });

  it.each(['/candidate', '/employer', '/faq', '/help', '/help/candidate', '/help/employer'])(
    'renders on public marketing route %s',
    (path) => {
      pathname = path;
      render(<BetaPromoBar />);
      expect(screen.getByRole('note')).toBeInTheDocument();
    },
  );

  it('renders on "/" only via the stacked prop (the generic mount skips it — see app/page.tsx)', () => {
    pathname = '/';
    const generic = render(<BetaPromoBar />);
    expect(generic.container).toBeEmptyDOMElement();
    generic.unmount();

    render(<BetaPromoBar stacked />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it.each([
    ['/assessments', 'assessment list'],
    ['/assessments/discussion/session/abc123', 'assessment-taking flow'],
    ['/employer/dashboard', 'authenticated employer portal'],
    ['/candidate/settings', 'not a real route, but not an accidental prefix match either'],
    ['/admin/dashboard', 'authenticated admin console'],
    ['/profile', 'authenticated candidate profile'],
    ['/upgrade', 'authenticated candidate billing'],
  ])('does not render on %s (%s)', (path) => {
    pathname = path;
    const { container } = render(<BetaPromoBar />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('BetaPromoBar — signed-in visitors', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00+05:30'));
  });

  it('hides for a signed-in candidate, even on an allowed path', async () => {
    setTokens('access-token', 'refresh-token');
    render(<BetaPromoBar stacked />);
    // The auth check is deferred to an effect (see BetaPromoBar's own doc
    // comment on why) — RTL's render() flushes effects via act() before
    // returning, so this should already be settled.
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('hides for a signed-in employer on /employer', async () => {
    pathname = '/employer';
    employerApi.setTokens('emp-access-token', 'emp-refresh-token');
    render(<BetaPromoBar />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders for an anonymous visitor on the same path', () => {
    render(<BetaPromoBar stacked />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});
