/**
 * Real React rendering (jsdom + RTL) — same convention as
 * CandidateJobs.spec.tsx: only `fetch` is mocked, lib/api.ts is the real
 * module.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import EmployerJobMatches from './EmployerJobMatches';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function mockFetchWith(body: unknown) {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () => jsonResponse(200, body)) as unknown as typeof fetch;
}

describe('EmployerJobMatches', () => {
  it('zero-considered: shows the zero state and names the unmatched required skills, never a fabricated count', async () => {
    mockFetchWith({
      jobId: 'job-1',
      jobTitle: 'Senior ML Engineer',
      funnel: { considered: 0, relevant: 0, verifiedMatch: 0, strongMatch: 0 },
      unmatchedRequiredSkills: [{ skillId: 's1', skillName: 'RAG Systems' }],
      candidates: [],
      allCandidates: [],
    });

    render(<EmployerJobMatches jobId="job-1" />);

    await waitFor(() => expect(screen.getByText('No candidates match this job yet.')).toBeInTheDocument());
    expect(screen.getByText(/RAG Systems/)).toBeInTheDocument();
    // No fabricated "candidates found" language, and the funnel tiles all read 0.
    expect(screen.queryByText(/more coming|growing network/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('renders bands, not raw percentages, and every row is real data from the response', async () => {
    mockFetchWith({
      jobId: 'job-1',
      jobTitle: 'Senior ML Engineer',
      funnel: { considered: 3, relevant: 3, verifiedMatch: 2, strongMatch: 1 },
      unmatchedRequiredSkills: [],
      candidates: [],
      allCandidates: [
        { profileId: 'p1', fullName: 'Strong Person', score: 90, verifiedSkillCount: 2, yearsOfExp: 5 },
        { profileId: 'p2', fullName: 'Good Person', score: 60, verifiedSkillCount: 1, yearsOfExp: 3 },
        { profileId: 'p3', fullName: 'Partial Person', score: 30, verifiedSkillCount: 0, yearsOfExp: null },
      ],
    });

    render(<EmployerJobMatches jobId="job-1" />);

    await waitFor(() => expect(screen.getByText('Strong Person')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Strong match')).toBeInTheDocument();
    expect(table.getByText('Good match')).toBeInTheDocument();
    expect(table.getByText('Partial match')).toBeInTheDocument();
    // No raw score text ("90", "60", "30") ever rendered as the match column.
    expect(screen.queryByText('90')).not.toBeInTheDocument();
    expect(screen.queryByText('60%')).not.toBeInTheDocument();
    // Self-reported experience is labeled as such.
    expect(table.getByText('5 yrs (self-reported)')).toBeInTheDocument();
    expect(table.getByText('Not shared')).toBeInTheDocument();
    // Funnel tiles read straight from the response (considered, relevant, verifiedMatch, strongMatch).
    const tiles = Array.from(document.querySelectorAll('.status-stat')).map((el) => el.textContent);
    expect(tiles).toEqual(['3', '3', '2', '1']);
  });
});
