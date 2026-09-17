/**
 * Real React rendering (jsdom + RTL), same convention as
 * lib/candidateVerification.spec.tsx / NewsStrip.spec.tsx: only `fetch` and
 * next/navigation are mocked, everything else (lib/api.ts) is the real
 * module.
 */
import '@testing-library/jest-dom';
import { ReactElement } from 'react';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import CandidateJobs from './CandidateJobs';
import { EntitlementsProvider } from '@/lib/entitlements';

let searchParams = new URLSearchParams('tab=matched');

jest.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  usePathname: () => '/jobs',
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

// CandidateJobs reads useEntitlements() (for applicationStatusDetail on the
// Applications tab) — real EntitlementsProvider, not a stand-in, same
// "use the real module" convention as the rest of this file.
function render(ui: ReactElement) {
  return rtlRender(<EntitlementsProvider>{ui}</EntitlementsProvider>);
}

const SKILL_A = { skillId: 's1', skillName: 'Prompt Engineering', requiredLevel: 'L1', isRequired: true };
const SKILL_B = { skillId: 's2', skillName: 'RAG Systems', requiredLevel: 'L2', isRequired: true };
const SKILL_C = { skillId: 's3', skillName: 'Fine-tuning', requiredLevel: 'L3', isRequired: false };

function mockFetchFor({
  matchedJobs,
  browseJobs = [],
  hasVerifiedSkills = true,
}: {
  matchedJobs: unknown[];
  browseJobs?: unknown[];
  hasVerifiedSkills?: boolean;
}) {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/jobs/matched')) return jsonResponse(200, { jobs: matchedJobs });
    if (url.includes('/jobs/browse')) {
      return jsonResponse(200, { total: browseJobs.length, limit: 25, offset: 0, jobs: browseJobs });
    }
    if (url.includes('/users/me')) {
      return jsonResponse(200, {
        profile: {
          skillClaims: hasVerifiedSkills ? [{ status: 'VERIFIED', badge: { verifyHash: 'x' } }] : [],
        },
      });
    }
    if (url.includes('/taxonomy')) return jsonResponse(200, []);
    if (url.includes('/me/entitlements')) return jsonResponse(404, {});
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams('tab=matched');
});

describe('CandidateJobs — Matched tab band display', () => {
  it('renders "Not yet a match" (not a number, not "0%") for a job scoring 0 — a 0 means no claim at all, not a weak match', async () => {
    mockFetchFor({
      matchedJobs: [
        {
          id: 'job-zero',
          title: 'Zero Match Role',
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: 'Remote',
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: [SKILL_A, SKILL_B],
          alreadyApplied: false,
          score: 0,
          matched: [],
          missing: [SKILL_A, SKILL_B].map((s) => ({ ...s, candidateLevel: null, verified: false })),
        },
      ],
    });

    render(<CandidateJobs />);

    await screen.findByText('Zero Match Role');
    expect(screen.getByText('Not yet a match')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    expect(document.querySelector('.progress-track')).not.toBeInTheDocument();
    expect(screen.getByText('0 of 2 skills verified')).toBeInTheDocument();
  });

  it('renders the fraction (matched.length of the job\'s total skill count), never the raw percentage, for a job scoring above 0', async () => {
    mockFetchFor({
      matchedJobs: [
        {
          id: 'job-partial',
          title: 'Partial Match Role',
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: 'Remote',
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: [SKILL_A, SKILL_B, SKILL_C],
          alreadyApplied: false,
          score: 17,
          matched: [{ ...SKILL_A, candidateLevel: 'L1', verified: true }],
          missing: [{ ...SKILL_B, candidateLevel: null, verified: false }],
        },
      ],
    });

    render(<CandidateJobs />);

    await screen.findByText('Partial Match Role');
    expect(screen.queryByText('17%')).not.toBeInTheDocument();
    expect(screen.queryByText('17')).not.toBeInTheDocument();
    expect(screen.getByText('Not yet a match')).toBeInTheDocument(); // 17 -> 'none' band
    // matched.length (1) of the job's total skill count (3) — not
    // matched.length + missing.length (2), which would undercount an
    // optional skill that fell through both buckets (scoring.ts: an
    // optional skill with partial, non-full credit lands in neither
    // `matched` nor `missing`).
    expect(screen.getByText('1 of 3 skills verified')).toBeInTheDocument();
    expect(document.querySelector('.progress-track')).not.toBeInTheDocument();
  });

  it.each([
    [0, 'Not yet a match'],
    [24, 'Not yet a match'],
    [25, 'Partial match'],
    [49, 'Partial match'],
    [50, 'Good match'],
    [74, 'Good match'],
    [75, 'Strong match'],
    [100, 'Strong match'],
  ])('score %i renders the "%s" band', async (score, label) => {
    mockFetchFor({
      matchedJobs: [
        {
          id: `job-${score}`,
          title: `Role ${score}`,
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: null,
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: [SKILL_A],
          alreadyApplied: false,
          score,
          matched: score > 0 ? [{ ...SKILL_A, candidateLevel: 'L1', verified: true }] : [],
          missing: score > 0 ? [] : [{ ...SKILL_A, candidateLevel: null, verified: false }],
        },
      ],
    });

    render(<CandidateJobs />);

    await screen.findByText(`Role ${score}`);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('distinguishes two "Not yet a match" jobs by their fraction: 0 of 7 vs 2 of 7', async () => {
    const sevenSkills = Array.from({ length: 7 }, (_, i) => ({
      skillId: `s${i}`,
      skillName: `Skill ${i}`,
      requiredLevel: 'L1',
      isRequired: true,
    }));

    mockFetchFor({
      matchedJobs: [
        {
          id: 'job-none-verified',
          title: 'No Claims Role',
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: null,
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: sevenSkills,
          alreadyApplied: false,
          score: 10,
          matched: [],
          missing: sevenSkills.map((s) => ({ ...s, candidateLevel: null, verified: false })),
        },
        {
          id: 'job-some-verified',
          title: 'Some Claims Role',
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: null,
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: sevenSkills,
          alreadyApplied: false,
          score: 15,
          matched: sevenSkills.slice(0, 2).map((s) => ({ ...s, candidateLevel: 'L1', verified: true })),
          missing: sevenSkills.slice(2).map((s) => ({ ...s, candidateLevel: null, verified: false })),
        },
      ],
    });

    render(<CandidateJobs />);

    await screen.findByText('No Claims Role');
    await screen.findByText('Some Claims Role');

    // Both land in the same ('none') band...
    expect(screen.getAllByText('Not yet a match')).toHaveLength(2);
    // ...but the fraction still tells them apart.
    expect(screen.getByText('0 of 7 skills verified')).toBeInTheDocument();
    expect(screen.getByText('2 of 7 skills verified')).toBeInTheDocument();
  });
});

describe('CandidateJobs — Matched tab empty state (unchanged)', () => {
  it('still shows the dedicated "earn a badge" empty state when the candidate has no verified skills at all', async () => {
    mockFetchFor({ matchedJobs: [], hasVerifiedSkills: false });

    render(<CandidateJobs />);

    await waitFor(() =>
      expect(
        screen.getByText(/Job matches are based on your verified skills\. Earn a badge to see roles that match you\./),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Take an assessment' })).toHaveAttribute('href', '/assessments');
  });

  it('still shows the "no live jobs to score yet" message when the candidate has verified skills but the match list is empty', async () => {
    mockFetchFor({ matchedJobs: [], hasVerifiedSkills: true });

    render(<CandidateJobs />);

    await waitFor(() => expect(screen.getByText(/No live jobs to score yet\./)).toBeInTheDocument());
  });
});

describe('CandidateJobs — Browse tab band display (new: browse never scored before)', () => {
  it('renders a band + fraction on Browse, joined from /jobs/matched by job id — no backend change, /jobs/browse itself carries no score', async () => {
    searchParams = new URLSearchParams('tab=browse');
    mockFetchFor({
      matchedJobs: [
        {
          id: 'job-1',
          title: 'Shared Role',
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: null,
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: [SKILL_A, SKILL_B],
          alreadyApplied: false,
          score: 80,
          matched: [
            { ...SKILL_A, candidateLevel: 'L1', verified: true },
            { ...SKILL_B, candidateLevel: 'L2', verified: true },
          ],
          missing: [],
        },
      ],
      browseJobs: [
        {
          id: 'job-1',
          title: 'Shared Role',
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: null,
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: [SKILL_A, SKILL_B],
          alreadyApplied: false,
        },
      ],
    });

    render(<CandidateJobs />);
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));

    await screen.findByText('Shared Role');
    expect(screen.getByText('Strong match')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 skills verified')).toBeInTheDocument();
  });

  it('renders no band on Browse for a job absent from /jobs/matched (e.g. the candidate has no verified claim anywhere yet)', async () => {
    searchParams = new URLSearchParams('tab=browse');
    mockFetchFor({
      matchedJobs: [], // the global short-circuit case
      browseJobs: [
        {
          id: 'job-unscored',
          title: 'Unscored Role',
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: null,
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: [SKILL_A],
          alreadyApplied: false,
        },
      ],
    });

    render(<CandidateJobs />);
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));

    await screen.findByText('Unscored Role');
    expect(screen.queryByText(/match$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/skills verified/)).not.toBeInTheDocument();
  });
});

describe('CandidateJobs — skill level display', () => {
  it('renders skill chips with human level names, not raw L1/L2/L3 codes', async () => {
    mockFetchFor({
      matchedJobs: [
        {
          id: 'job-levels',
          title: 'Levels Role',
          orgName: 'Acme',
          employmentType: 'FULL_TIME',
          location: null,
          remote: true,
          experienceMin: null,
          experienceMax: null,
          skills: [SKILL_A, SKILL_C],
          alreadyApplied: false,
          score: 25,
          matched: [{ ...SKILL_A, candidateLevel: 'L1', verified: true }],
          missing: [],
        },
      ],
    });

    render(<CandidateJobs />);

    await screen.findByText('Levels Role');
    expect(screen.getByText(/Prompt Engineering \(Foundational\)/)).toBeInTheDocument();
    expect(screen.getByText(/Fine-tuning \(Advanced, optional\)/)).toBeInTheDocument();
    expect(screen.queryByText(/\(L1\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(L3/)).not.toBeInTheDocument();
  });
});
