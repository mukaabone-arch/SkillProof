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
 *
 * BetaPromoBar and BetaPromoScroll (the landing/candidate-login ribbon
 * that replaced the bar on those two pages) share one visibility rule
 * (useBetaPromoVisible) — covered once here rather than duplicated into a
 * separate ribbon spec, per this repo's mixed one-spec-per-component
 * convention (most components have none at all).
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import BetaPromoBar from './BetaPromoBar';
import BetaPromoScroll from './BetaPromoScroll';
import { setTokens, clearTokens, employerApi } from '@/lib/api';
import { BETA_FREE_UNTIL } from '@/lib/betaPromo';

// A path that stays in BetaPromoBar's allow-list throughout this file —
// '/' and '/candidate' are deliberately NOT in it any more (see the
// "route gating" describe below): both now render BetaPromoScroll instead,
// which has no path awareness of its own.
let pathname = '/employer';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

beforeEach(() => {
  pathname = '/employer';
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
    render(<BetaPromoBar />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('renders in the last second before the cutoff instant', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-30T23:59:59+05:30'));
    render(<BetaPromoBar />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('returns null one second after the cutoff instant', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-01T00:00:00+05:30'));
    const { container } = render(<BetaPromoBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null well after the cutoff', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-15T00:00:00+05:30'));
    const { container } = render(<BetaPromoBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the IST cutoff, not a UTC one: 20:00 UTC on 30 Nov is still labelled "the 30th" in UTC, but IST (UTC+5:30) is already past the 23:59:59 IST cutoff (18:29:59 UTC) by then', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-30T20:00:00Z'));
    const { container } = render(<BetaPromoBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders for an IST evening moment on the 30th, even though the equivalent UTC clock reading is earlier that same UTC day', () => {
    // 2026-11-30T15:00:00Z = 2026-11-30T20:30:00+05:30 — well within the window.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-30T15:00:00Z'));
    render(<BetaPromoBar />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});

describe('BetaPromoBar — copy', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00+05:30'));
  });

  it('matches the required copy exactly, with the date read from BETA_FREE_UNTIL', () => {
    render(<BetaPromoBar />);
    expect(BETA_FREE_UNTIL.toISOString()).toBe('2026-11-30T18:29:59.000Z');
    expect(screen.getByRole('note')).toHaveTextContent(
      'Candidates: Be among the first to prove your AI skills and apply for jobs — Free until 30 November 2026',
    );
  });
});

describe('BetaPromoBar — route gating', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00+05:30'));
  });

  it.each(['/employer', '/faq', '/help', '/help/candidate', '/help/employer'])(
    'renders on public marketing route %s',
    (path) => {
      pathname = path;
      render(<BetaPromoBar />);
      expect(screen.getByRole('note')).toBeInTheDocument();
    },
  );

  it.each([
    ['/', 'landing page — renders .beta-promo-scroll instead, not this bar'],
    ['/candidate', 'candidate login — renders .beta-promo-scroll instead, not this bar'],
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
    render(<BetaPromoBar />);
    // The auth check is deferred to an effect (see useBetaPromoVisible's
    // own doc comment on why) — RTL's render() flushes effects via act()
    // before returning, so this should already be settled.
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('hides for a signed-in employer on /employer', async () => {
    employerApi.setTokens('emp-access-token', 'emp-refresh-token');
    render(<BetaPromoBar />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders for an anonymous visitor on the same path', () => {
    render(<BetaPromoBar />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});

describe('BetaPromoScroll — the landing/candidate-login ribbon', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00+05:30'));
  });

  it('renders for an anonymous visitor while the offer is live', () => {
    render(<BetaPromoScroll />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('returns null once the offer is over (same cutoff as the bar, via the shared hook)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-01T00:00:00+05:30'));
    const { container } = render(<BetaPromoScroll />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides for a signed-in candidate', () => {
    setTokens('access-token', 'refresh-token');
    render(<BetaPromoScroll />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('hides for a signed-in employer', () => {
    employerApi.setTokens('emp-access-token', 'emp-refresh-token');
    render(<BetaPromoScroll />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('has no path allow-list of its own — it renders the same way regardless of route', () => {
    pathname = '/some/arbitrary/route';
    render(<BetaPromoScroll />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('renders the exact same fact as the bar — same date, from the same source', () => {
    const { unmount } = render(<BetaPromoBar />);
    const barText = screen.getByRole('note').textContent;
    unmount();

    render(<BetaPromoScroll />);
    // Not an exact string match: the ribbon deliberately drops the bar's
    // leading em dash before "Free" (see BetaPromoScroll.tsx's own doc
    // comment — orphaned punctuation once the date is forced onto its own
    // line). Same date, same "Candidates: Be among the first..." lead.
    expect(barText).toContain('30 November 2026');
    expect(screen.getByRole('note')).toHaveTextContent(
      'Candidates: Be among the first to prove your AI skills and apply for jobs',
    );
    expect(screen.getByRole('note')).toHaveTextContent('Free until 30 November 2026');
  });
});
