/**
 * Real React rendering (jsdom + RTL), same convention as CandidateJobs.spec.tsx:
 * only `fetch` and next/navigation are mocked; EntitlementsProvider is real.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CandidateNav from './CandidateNav';
import { EntitlementsProvider } from '@/lib/entitlements';

jest.mock('next/navigation', () => ({
  usePathname: () => '/candidate',
  useRouter: () => ({ replace: jest.fn() }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function mockFetch() {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
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

function renderNav() {
  localStorage.setItem('sp_token', 'test-access-token');
  return render(
    <EntitlementsProvider>
      <CandidateNav onLoggedOut={jest.fn()} />
    </EntitlementsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockFetch();
});

describe('CandidateNav', () => {
  it('renders its seven nav items (six links + Upgrade on the free tier) alongside the account control', async () => {
    renderNav();

    await waitFor(() => expect(screen.getByRole('link', { name: 'Upgrade' })).toBeInTheDocument());
    for (const label of ['Dashboard', 'Profile', 'Assessments', 'Jobs', 'Interviews', 'Help']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /menu/ })).toBeInTheDocument();
  });

  it("the account menu contains Profile, Account and Log out, under the candidate's own name", async () => {
    renderNav();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Jordan Lee menu' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Jordan Lee menu' }));

    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('menuitem', { name: 'Account' })).toHaveAttribute('href', '/profile/account');
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });
});
