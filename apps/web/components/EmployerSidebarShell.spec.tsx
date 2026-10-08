/**
 * The employer topbar's identity block, "Post a job," and account menu.
 * Real React rendering (jsdom + RTL); only next/navigation and the logo
 * blob fetch are stubbed.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EmployerSidebarShell, { type EmployerOrgIdentity } from './EmployerSidebarShell';

jest.mock('next/navigation', () => ({
  usePathname: () => '/employer/dashboard',
  useRouter: () => ({ replace: jest.fn() }),
}));

function logoBlobResponse(): Response {
  return { ok: true, status: 200, blob: async () => new Blob(['png-bytes']) } as unknown as Response;
}

beforeEach(() => {
  Object.defineProperty(window.URL, 'createObjectURL', { writable: true, value: jest.fn(() => 'blob:fake-logo') });
  Object.defineProperty(window.URL, 'revokeObjectURL', { writable: true, value: jest.fn() });
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/orgs/me/logo')) return logoBlobResponse();
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

function renderShell(org: EmployerOrgIdentity | null) {
  return render(
    <EmployerSidebarShell verified org={org} onLoggedOut={jest.fn()}>
      <p>content</p>
    </EmployerSidebarShell>,
  );
}

describe('EmployerSidebarShell — org identity', () => {
  it('renders the org name and logo when both are present', async () => {
    renderShell({ name: 'Acme Robotics', hasLogo: true });

    // Scoped to the org-identity link, not the page overall — BrandLockup's
    // own MyAmbii mark is also an <img>.
    const orgLink = screen.getByRole('link', { name: 'Acme Robotics' });
    await waitFor(() => expect(within(orgLink).getByRole('img')).toHaveAttribute('src', 'blob:fake-logo'));
  });

  it('renders initials, not a broken image, when the org has no logo', () => {
    renderShell({ name: 'Acme Robotics', hasLogo: false });

    const orgLink = screen.getByRole('link', { name: 'Acme Robotics' });
    expect(within(orgLink).queryByRole('img')).not.toBeInTheDocument();
    expect(within(orgLink).getByText('AR')).toBeInTheDocument();
  });

  it('renders nothing where the identity block goes until the org loads', () => {
    renderShell(null);
    expect(screen.queryByText(/Acme/)).not.toBeInTheDocument();
  });
});

describe('EmployerSidebarShell — Post a job', () => {
  it('links to the jobs page with the auto-open query param, from any screen', () => {
    renderShell({ name: 'Acme Robotics', hasLogo: false });
    expect(screen.getByRole('link', { name: /Post a job/ })).toHaveAttribute('href', '/employer/jobs?new=1');
  });
});

describe('EmployerSidebarShell — account menu', () => {
  it('contains Settings, Billing, Team members and Log out', () => {
    renderShell({ name: 'Acme Robotics', hasLogo: false });

    fireEvent.click(screen.getByRole('button', { name: 'Acme Robotics menu' }));

    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/employer/settings');
    expect(screen.getByRole('menuitem', { name: 'Billing' })).toHaveAttribute('href', '/employer/billing');
    expect(screen.getByRole('menuitem', { name: 'Team members' })).toHaveAttribute('href', '/employer/settings#team');
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });
});
