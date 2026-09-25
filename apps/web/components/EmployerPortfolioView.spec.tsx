/**
 * Real React rendering (jsdom + RTL) — same convention as
 * CandidateJobs.spec.tsx: only `fetch` is mocked, lib/api.ts is the real
 * module.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import EmployerPortfolioView from './EmployerPortfolioView';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('EmployerPortfolioView', () => {
  it('renders a calm empty state on 404, not raw error text', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () =>
      jsonResponse(404, { statusCode: 404, message: 'Not Found' }),
    ) as unknown as typeof fetch;

    render(<EmployerPortfolioView candidateId="cand-1" />);

    await waitFor(() => expect(screen.getByText("This candidate hasn't published a portfolio.")).toBeInTheDocument());
    expect(screen.queryByText('Not Found')).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it('renders ErrorState for a genuine (non-404) failure', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () =>
      jsonResponse(500, { message: 'Something broke' }),
    ) as unknown as typeof fetch;

    render(<EmployerPortfolioView candidateId="cand-1" />);

    await waitFor(() => expect(screen.getByText('Something broke')).toBeInTheDocument());
    expect(screen.queryByText("This candidate hasn't published a portfolio.")).not.toBeInTheDocument();
  });

  it('renders portfolio content on success', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () =>
      jsonResponse(200, {
        fullName: 'Ada Lovelace',
        headline: 'Backend engineer',
        location: null,
        yearsOfExp: 5,
        githubUrl: null,
        linkedinUrl: null,
        content: { headline: null, summary: null, experience: [], projects: [], education: [], skillGroups: [] },
        verifiedBadges: [],
        verifiedCertifications: [],
        contact: null,
      }),
    ) as unknown as typeof fetch;

    render(<EmployerPortfolioView candidateId="cand-1" />);

    await waitFor(() => expect(screen.getByText(/self-reported by the/)).toBeInTheDocument());
    expect(screen.queryByText("This candidate hasn't published a portfolio.")).not.toBeInTheDocument();
  });
});
