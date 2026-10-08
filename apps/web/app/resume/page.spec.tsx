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

function mockFetch() {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/profiles/me/resume/generate')) return pdfResponse();
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
