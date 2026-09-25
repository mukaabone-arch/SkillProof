/**
 * Real React rendering (jsdom + RTL) — same convention as
 * CandidateJobs.spec.tsx: only `fetch` is mocked, lib/api.ts is the real
 * module.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import EmployerApplicants from './EmployerApplicants';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function baseApplicant(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: 'app-1',
    status: 'APPLIED',
    appliedAt: new Date().toISOString(),
    jobId: 'job-1',
    jobTitle: 'Backend Engineer',
    jobCode: 'BE-01',
    profileId: 'cand-1',
    fullName: 'Ada Lovelace',
    headline: 'Backend engineer',
    roleTitle: null,
    roleTitleOther: null,
    location: null,
    yearsOfExp: 5,
    githubUrl: null,
    linkedinUrl: null,
    hasPhoto: false,
    hasResume: false,
    hasPortfolio: false,
    profileIncomplete: false,
    score: null,
    verifiedSkills: [],
    externalCredentials: [],
    ...overrides,
  };
}

function mockFetchWith(applicants: unknown[]) {
  let fetchCount = 0;
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    fetchCount += 1;
    const url = String(input);
    if (url.includes('/jobs/applicants')) return jsonResponse(200, applicants);
    if (url.includes('/shortlist')) return jsonResponse(200, []);
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;
  return () => fetchCount;
}

describe('EmployerApplicants — portfolio link gating', () => {
  it('renders no "View portfolio" link when hasPortfolio is false, straight from the list payload', async () => {
    mockFetchWith([baseApplicant({ hasPortfolio: false })]);

    render(<EmployerApplicants />);

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    expect(screen.queryByText(/View portfolio/)).not.toBeInTheDocument();
  });

  it('renders the "View portfolio" link when hasPortfolio is true, with no extra request beyond the list load', async () => {
    const getFetchCount = mockFetchWith([baseApplicant({ hasPortfolio: true })]);

    render(<EmployerApplicants />);

    await waitFor(() => expect(screen.getByText(/View portfolio/)).toBeInTheDocument());
    // Only the applicants list + shortlist load — no per-card portfolio probe.
    expect(getFetchCount()).toBe(2);
  });
});
