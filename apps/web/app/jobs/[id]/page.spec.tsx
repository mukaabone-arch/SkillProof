/**
 * The apply-gate progress message's level-name fallback — the actual call
 * site this branch exists for (see entitlements.tsx's own comment: the web
 * deploys on merge, the API deploy is manual, so a deployed client can be
 * talking to an API that predates levelNamesHeld/levelNamesRemaining).
 * Real React rendering (jsdom + RTL); only `fetch` and next/navigation are
 * mocked, EntitlementsProvider is the real module.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import JobDetailPage from './page';
import { EntitlementsProvider } from '@/lib/entitlements';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'job-1' }),
  usePathname: () => '/jobs/job-1',
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const JOB = {
  id: 'job-1',
  title: 'Senior ML Engineer',
  orgName: 'Acme Robotics',
  employmentType: 'FULL_TIME',
  location: 'Bangalore',
  remote: false,
  experienceMin: null,
  experienceMax: null,
  description: 'Build things.',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: 'INR',
  salaryNotDisclosed: true,
  skills: [],
  alreadyApplied: false,
};

/** `progress` as given — the test controls whether levelNamesHeld/-Remaining are present. */
function mockFetch(progress: Record<string, unknown>, job: Record<string, unknown> = JOB) {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/jobs/browse/job-1')) return jsonResponse(200, job);
    if (url.includes('/jobs/matched')) return jsonResponse(200, { jobs: [] });
    if (url.includes('/profiles/me')) return jsonResponse(200, { resumeS3Key: 'resume.pdf', aiYearsOfExp: 3 });
    if (url.includes('/me/entitlements')) {
      return jsonResponse(200, {
        tier: 'FREE',
        limits: { gapAnalysis: 'basic' },
        usage: {
          assessments: { used: 0, limit: null, resetsAt: '' },
          applications: { used: 0, limit: null, resetsAt: '' },
          discussionSessions: { used: 0, limit: null, resetsAt: '' },
        },
        freeSkillLock: null,
        premiumEnabled: false,
        applyGate: { requiredLevels: ['L1', 'L2', 'L3'], met: false, progress },
      });
    }
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;
}

async function renderPage(progress: Record<string, unknown>) {
  localStorage.setItem('sp_token', 'test-access-token');
  mockFetch(progress);
  render(
    <EntitlementsProvider>
      <JobDetailPage />
    </EntitlementsProvider>,
  );
  return screen.findByText(/earned/);
}

beforeEach(() => localStorage.clear());

describe('Job detail — apply-gate progress message', () => {
  const PROGRESS_BASE = { skillId: 's1', skillName: 'RAG Systems', levelsHeld: ['L1'], levelsRemaining: ['L2', 'L3'] };

  it('renders the name fields when the API provides them', async () => {
    const text = await renderPage({
      ...PROGRESS_BASE,
      levelNamesHeld: ['Foundational'],
      levelNamesRemaining: ['Practitioner', 'Advanced'],
    });

    expect(text).toHaveTextContent('RAG Systems: Foundational earned — Practitioner and Advanced to go before you can apply to jobs.');
  });

  it('renders the same text, derived from the codes, when the name fields are absent — and does not throw', async () => {
    // No levelNamesHeld/levelNamesRemaining at all — an API that predates them.
    const text = await renderPage(PROGRESS_BASE);

    expect(text).toHaveTextContent('RAG Systems: Foundational earned — Practitioner and Advanced to go before you can apply to jobs.');
  });
});

describe('Job detail — agency postings', () => {
  it('names the agency and the confidential client, and says who gets the candidate’s details', async () => {
    localStorage.setItem('sp_token', 'test-access-token');
    mockFetch(
      { skillId: 's1', skillName: 'RAG Systems', levelsHeld: [], levelsRemaining: ['L1'] },
      { ...JOB, orgName: 'Talent Partners', postedFor: 'a confidential client', agencyPosting: true },
    );
    render(
      <EntitlementsProvider>
        <JobDetailPage />
      </EntitlementsProvider>,
    );
    expect(await screen.findByText(/Posted by Talent Partners for a confidential client/)).toBeInTheDocument();
    expect(screen.getByText('This job is posted by a recruiting agency. Your name and contact details go to Talent Partners.')).toBeInTheDocument();
  });

  it('shows neither on an employer’s own job', async () => {
    localStorage.setItem('sp_token', 'test-access-token');
    mockFetch({ skillId: 's1', skillName: 'RAG Systems', levelsHeld: [], levelsRemaining: ['L1'] });
    render(
      <EntitlementsProvider>
        <JobDetailPage />
      </EntitlementsProvider>,
    );
    await screen.findByRole('heading', { name: 'Senior ML Engineer' });
    expect(screen.queryByText(/Posted by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/recruiting agency/)).not.toBeInTheDocument();
  });
});
