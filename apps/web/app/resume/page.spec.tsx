/**
 * Real React rendering (jsdom + RTL), same convention as CandidateJobs.spec.tsx:
 * only `fetch`, next/navigation, and the anchor-click download are stubbed.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ResumePage from './page';
import { EntitlementsProvider } from '@/lib/entitlements';
import { RESUME_SKILLS_MAX, RESUME_SKILL_MAX_LENGTH } from '@/lib/resumeLimits';

jest.mock('next/navigation', () => ({
  usePathname: () => '/resume',
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function pdfResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), blob: async () => new Blob(['pdf']) } as unknown as Response;
}

// null (the default) means "no parsed portfolio" — GET /portfolio/me 404s,
// and the page falls back to the plain manual field, same as before this
// selector existed. Set per-test to exercise the selector.
let portfolioFixture: Response | null = null;

function makeGroups(sizes: number[]): { category: string; skills: string[] }[] {
  return sizes.map((size, gi) => ({
    category: `Category ${gi + 1}`,
    skills: Array.from({ length: size }, (_, si) => `Skill ${gi}-${si}`),
  }));
}

function portfolioResponse(
  skillGroups: { category: string; skills: string[] }[],
  verifiedBadges: Array<{ skillName: string }> = [],
): Response {
  return jsonResponse(200, {
    content: { headline: null, summary: null, experience: [], projects: [], education: [], skillGroups },
    verifiedBadges,
  });
}

function mockFetch() {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/profiles/me/resume/generate')) return pdfResponse();
    if (url.includes('/portfolio/me')) return portfolioFixture ?? jsonResponse(404, {});
    if (url.includes('/profiles/me')) return jsonResponse(200, { resumeS3Key: null });
    if (url.includes('/me/entitlements')) {
      return jsonResponse(200, {
        tier: 'FREE',
        limits: { resumeBranding: true },
        usage: {},
        freeSkillLock: null,
        premiumEnabled: false,
        applyGate: null,
      });
    }
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;
}

function generateCallBody(): { skills?: string[] } {
  const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit?][];
  const call = calls.find(([url]) => url.includes('/profiles/me/resume/generate'));
  return JSON.parse((call?.[1]?.body as string) ?? '{}');
}

async function goToReview() {
  localStorage.setItem('sp_token', 'test-access-token');
  render(
    <EntitlementsProvider>
      <ResumePage />
    </EntitlementsProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Build from my profile' }));
  await screen.findByText('Review your resume');
}

function setSkills(value: string) {
  fireEvent.change(screen.getByLabelText(/^Skills/), { target: { value } });
}

function generateButton() {
  return screen.getByRole('button', { name: 'Generate PDF →' });
}

beforeEach(() => {
  localStorage.clear();
  portfolioFixture = null;
  mockFetch();
  Object.defineProperty(window.URL, 'createObjectURL', { writable: true, value: jest.fn(() => 'blob:mock') });
  Object.defineProperty(window.URL, 'revokeObjectURL', { writable: true, value: jest.fn() });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Resume builder — skills limit', () => {
  it('renders the live count and updates it as the field changes', async () => {
    await goToReview();

    expect(screen.getByText(`0 of ${RESUME_SKILLS_MAX}`)).toBeInTheDocument();

    setSkills('React, Node, SQL');

    expect(screen.getByText(`3 of ${RESUME_SKILLS_MAX}`)).toBeInTheDocument();
  });

  it('disables Generate PDF once the skills count exceeds the limit', async () => {
    await goToReview();
    const tooMany = Array.from({ length: RESUME_SKILLS_MAX + 1 }, (_, i) => `Skill${i}`).join(', ');

    setSkills(tooMany);

    expect(screen.getByText(`${RESUME_SKILLS_MAX + 1} of ${RESUME_SKILLS_MAX}`)).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });

  it('flags an entry longer than the per-item limit, and only that one', async () => {
    await goToReview();
    const tooLong = 'a'.repeat(RESUME_SKILL_MAX_LENGTH + 1);

    setSkills(`React, ${tooLong}, SQL`);

    expect(screen.getByText(new RegExp(tooLong))).toBeInTheDocument();
    expect(screen.queryByText(/"React"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"SQL"/)).not.toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });

  it('submits at exactly the limit', async () => {
    await goToReview();
    const exactly = Array.from({ length: RESUME_SKILLS_MAX }, (_, i) => `Skill${i}`).join(', ');

    setSkills(exactly);
    expect(generateButton()).not.toBeDisabled();

    fireEvent.click(generateButton());

    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(screen.queryByText(/must contain no more than/)).not.toBeInTheDocument();
  });
});

// Group sizes are the exact production measurement that triggered this fix:
// one CandidatePortfolio, 9 groups, 85 skills, parsed 2026-10-08T04:48:20Z.
const PRODUCTION_GROUP_SIZES = [9, 7, 18, 13, 9, 5, 10, 7, 7];

describe('Resume builder — portfolio skill selector', () => {
  it('renders one entry per group with its count, matching the production shape', async () => {
    portfolioFixture = portfolioResponse(makeGroups(PRODUCTION_GROUP_SIZES));

    await goToReview();

    PRODUCTION_GROUP_SIZES.forEach((size, gi) => {
      expect(screen.getByText(new RegExp(`Category ${gi + 1} \\(${size}\\)`))).toBeInTheDocument();
    });
  });

  it('selecting a group adds its skills to the count; deselecting removes them', async () => {
    portfolioFixture = portfolioResponse(makeGroups([3, 4]));
    await goToReview();

    // No verified badges overlap, so the larger group (4) is the default.
    expect(screen.getByText(`4 of ${RESUME_SKILLS_MAX}`)).toBeInTheDocument();

    const group1 = screen.getByRole('checkbox', { name: /Category 1 \(3\)/ });
    fireEvent.click(group1);
    expect(screen.getByText(`7 of ${RESUME_SKILLS_MAX}`)).toBeInTheDocument();

    fireEvent.click(group1);
    expect(screen.getByText(`4 of ${RESUME_SKILLS_MAX}`)).toBeInTheDocument();
  });

  it('the count and the disabled state track RESUME_SKILLS_MAX, not a literal', async () => {
    const oversized = RESUME_SKILLS_MAX + 5;
    portfolioFixture = portfolioResponse(makeGroups([oversized]));

    await goToReview();

    expect(screen.getByText(`${oversized} of ${RESUME_SKILLS_MAX}`)).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });

  it('generates with only the selected skills', async () => {
    portfolioFixture = portfolioResponse(makeGroups([2, 2]));
    await goToReview();

    // Tied sizes default to the first group; swap the selection to the
    // second group's first skill only, to prove both group- and
    // individual-skill selection feed the same submitted list.
    fireEvent.click(screen.getByRole('checkbox', { name: /Category 1 \(2\)/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Skill 1-0' }));
    expect(screen.getByText(`1 of ${RESUME_SKILLS_MAX}`)).toBeInTheDocument();

    fireEvent.click(generateButton());
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());

    expect(generateCallBody().skills).toEqual(['Skill 1-0']);
  });

  it('defaults to a non-empty selection for a candidate with a parsed portfolio', async () => {
    portfolioFixture = portfolioResponse(makeGroups(PRODUCTION_GROUP_SIZES));

    await goToReview();

    expect(screen.queryByText(`0 of ${RESUME_SKILLS_MAX}`)).not.toBeInTheDocument();
  });

  it('defaults to the groups that overlap a verified badge, when any exist', async () => {
    const groups = makeGroups([2, 2, 2]);
    groups[1].skills[0] = 'Verified Skill';
    portfolioFixture = portfolioResponse(groups, [{ skillName: 'Verified Skill' }]);

    await goToReview();

    expect(screen.getByRole('checkbox', { name: /Category 2 \(2\)/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Category 1 \(2\)/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Category 3 \(2\)/ })).not.toBeChecked();
  });

  it('falls back to the plain manual field when there is no parsed portfolio', async () => {
    portfolioFixture = null; // GET /portfolio/me 404s — the default in beforeEach, set explicitly for clarity

    await goToReview();

    expect(screen.getByLabelText(/^Skills \(comma-separated\)/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
