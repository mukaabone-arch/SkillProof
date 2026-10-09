/**
 * Real React rendering (jsdom + RTL), same convention as resume/page.spec.tsx.
 * Covers what jsdom can actually check for the container-tier fix: which
 * class the page's <main> carries, and which elements carry the class that
 * caps long-form text to the reading measure. jsdom has no CSS engine, so
 * it can't evaluate a media query or a computed grid layout — the
 * two-column/900px-breakpoint behaviour those rules produce is instead
 * asserted directly against the stylesheet in globals.portfolio-layout.spec.ts.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import PortfolioPage from './page';
import { EntitlementsProvider } from '@/lib/entitlements';

jest.mock('next/navigation', () => ({
  usePathname: () => '/portfolio',
  useRouter: () => ({ replace: jest.fn() }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const PORTFOLIO_CONTENT = {
  headline: 'Senior ML Engineer',
  summary: 'Built and shipped production ML systems for five years across two startups.',
  experience: [{ title: 'ML Engineer', company: 'Acme', dates: '2021–2024', bullets: ['Shipped a thing'] }],
  projects: [{ name: 'Side Project', description: 'A thing I built on weekends.', technologies: ['Python'], url: null }],
  education: [{ degree: 'B.Tech', institution: 'IIT', dates: '2017–2021' }],
  skillGroups: [{ category: 'Languages', skills: ['Python', 'TypeScript'] }],
};

function mockFetch() {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/portfolio/me')) {
      return jsonResponse(200, {
        hasResume: true,
        fullName: 'Jordan Lee',
        headline: 'Senior ML Engineer',
        location: 'Bangalore',
        yearsOfExp: 5,
        githubUrl: null,
        linkedinUrl: null,
        content: PORTFOLIO_CONTENT,
        approvedAt: null,
        visibleToEmployers: false,
        parsedAt: '2026-10-01T00:00:00Z',
        verifiedBadges: [],
        verifiedCertifications: [],
      });
    }
    if (url.includes('/profiles/me')) return jsonResponse(200, { fullName: 'Jordan Lee' });
    if (url.includes('/me/entitlements')) {
      return jsonResponse(200, {
        tier: 'FREE',
        limits: {},
        usage: {},
        freeSkillLock: null,
        premiumEnabled: false,
        applyGate: null,
      });
    }
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;
}

async function renderLoaded() {
  localStorage.setItem('sp_token', 'test-access-token');
  mockFetch();
  render(
    <EntitlementsProvider>
      <PortfolioPage />
    </EntitlementsProvider>,
  );
  await screen.findByText('Draft — not yet approved');
}

beforeEach(() => localStorage.clear());

describe('Portfolio page — container tier', () => {
  it('renders inside container-standard in the loading state', () => {
    // Pre-token-check render: `ready` is still false on first paint.
    const { container } = render(<PortfolioPage />);
    expect(container.querySelector('main')).toHaveClass('container-standard');
    expect(container.querySelector('main')).not.toHaveClass('container-reading');
  });

  it('renders inside container-standard once loaded — the same class as loading, so the page does not jump width', async () => {
    await renderLoaded();
    const main = screen.getByRole('heading', { name: 'Your portfolio' }).closest('main');
    expect(main).toHaveClass('container-standard');
    expect(main).not.toHaveClass('container-reading');
  });
});

describe('Portfolio page — prose stays at reading width', () => {
  it('caps the page intro and every long-form textarea with .portfolio-prose', async () => {
    await renderLoaded();

    expect(screen.getByText(/A richer, shareable view/)).toHaveClass('portfolio-prose');
    expect(screen.getByLabelText('Summary')).toHaveClass('portfolio-prose');
    expect(screen.getByLabelText('Bullets (one per line)')).toHaveClass('portfolio-prose');
    expect(screen.getByLabelText('Description')).toHaveClass('portfolio-prose');
  });

  it('does not cap short structured fields (Title, Dates, Technologies, rendered via Field as plain <input>s)', async () => {
    await renderLoaded();

    // Field doesn't pair its <label> with its <input> via for/id, so these
    // aren't reachable by getByLabelText — asserting on every <input> on
    // the page is still a direct, honest check that .portfolio-prose
    // landed only on the three <textarea>s it was meant for.
    const inputs = document.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((input) => expect(input).not.toHaveClass('portfolio-prose'));
  });
});

describe('Portfolio page — card alignment', () => {
  it('renders the identity card through the same .portfolio-view this page scopes to full width', async () => {
    await renderLoaded();
    // Switch to the preview, where the Approved panel and the identity
    // card (inside PortfolioSections' .portfolio-view) stack directly —
    // the actual bug item 4 describes.
    await waitFor(() => screen.getByRole('button', { name: 'Preview →' }).click());

    expect(screen.getByText('Jordan Lee').closest('.portfolio-view')).toBeInTheDocument();
  });
});
