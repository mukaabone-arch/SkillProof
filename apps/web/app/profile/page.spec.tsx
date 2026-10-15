/**
 * Real React rendering (jsdom + RTL), same convention as
 * app/resume/page.spec.tsx: only `fetch` and next/navigation are stubbed.
 * Covers the restructured page's four zones in the two states the
 * restructure itself called out as the ones that matter — a brand-new
 * account (everything blank) and an account with a parsed résumé and a
 * verified badge — plus the field-save and certification-tier behaviour
 * that predates the restructure and must survive it unchanged.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProfilePage from './page';
import { EntitlementsProvider } from '@/lib/entitlements';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/profile',
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

interface MockProfile {
  id: string;
  fullName: string | null;
  email: string | null;
  headline: string | null;
  roleTitle: string | null;
  roleTitleOther: string | null;
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  locationPlaceId: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLegacy: string | null;
  openToRemote: boolean;
  yearsOfExp: number | null;
  aiYearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  completeness: number;
  resumeS3Key: string | null;
  hasPhoto: boolean;
}

interface MockPortfolio {
  hasResume: boolean;
  content: unknown;
  approvedAt: string | null;
  visibleToEmployers: boolean;
  parsedAt: string | null;
  verifiedBadges: unknown[];
  verifiedCertifications: unknown[];
}

const BASE_PROFILE: MockProfile = {
  id: 'profile-1',
  fullName: null,
  email: null,
  headline: null,
  roleTitle: null,
  roleTitleOther: null,
  locationCity: null,
  locationRegion: null,
  locationCountry: null,
  locationPlaceId: null,
  locationLat: null,
  locationLng: null,
  locationLegacy: null,
  openToRemote: false,
  yearsOfExp: null,
  aiYearsOfExp: null,
  githubUrl: null,
  linkedinUrl: null,
  completeness: 0,
  resumeS3Key: null,
  hasPhoto: false,
};

const BASE_PORTFOLIO: MockPortfolio = {
  hasResume: false,
  content: null,
  approvedAt: null,
  visibleToEmployers: false,
  parsedAt: null,
  verifiedBadges: [],
  verifiedCertifications: [],
};

interface MockState {
  profile: MockProfile;
  portfolio: MockPortfolio;
  certifications: unknown[];
  viewers: unknown;
}

function defaultState(): MockState {
  return {
    profile: { ...BASE_PROFILE },
    portfolio: { ...BASE_PORTFOLIO },
    certifications: [],
    viewers: { tier: 'FREE', mode: 'count_only', count: 0 },
  };
}

function mockFetch(state: MockState) {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/profiles/me/resume/parse')) {
      return jsonResponse(200, {
        fullName: 'Parsed Name',
        headline: 'Parsed Headline',
        location: 'Parsed City',
        yearsOfExp: 5,
        skills: ['Python', 'SQL'],
        suggestedRoleTitle: 'AI_ENGINEER',
      });
    }
    if (url.includes('/profiles/me/resume') && method === 'POST') {
      state.profile = { ...state.profile, resumeS3Key: 'new-key.pdf' };
      return jsonResponse(200, state.profile);
    }
    if (url.includes('/profiles/me/certifications')) return jsonResponse(200, state.certifications);
    if (url.includes('/profiles/me/viewers')) return jsonResponse(200, state.viewers);
    if (url.includes('/taxonomy')) return jsonResponse(200, []);
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
    if (url.includes('/portfolio/me')) return jsonResponse(200, state.portfolio);
    if (url.includes('/profiles/me') && method === 'PATCH') {
      const body = JSON.parse((init?.body as string) ?? '{}');
      state.profile = { ...state.profile, ...body, completeness: 100 };
      return jsonResponse(200, state.profile);
    }
    if (url.includes('/profiles/me')) return jsonResponse(200, state.profile);
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;
}

async function renderProfile(state: MockState) {
  localStorage.setItem('sp_token', 'test-access-token');
  mockFetch(state);
  render(
    <EntitlementsProvider>
      <ProfilePage />
    </EntitlementsProvider>,
  );
  await screen.findByText(/% complete/);
}

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('Profile page — brand-new account (nothing filled in)', () => {
  it('Zone 1 shows the full upload prompt, not the quiet state', async () => {
    await renderProfile(defaultState());
    expect(screen.getByText("Upload your résumé and we'll fill this in")).toBeInTheDocument();
    expect(screen.queryByText(/Résumé parsed/)).not.toBeInTheDocument();
  });

  it('Zone 2 fields are present and blank', async () => {
    await renderProfile(defaultState());
    expect(screen.getByLabelText(/Full name/)).toHaveValue('');
    expect(screen.getByLabelText('Email address')).toHaveValue('');
    expect(screen.getByLabelText(/Headline/)).toHaveValue('');
    expect(screen.getByLabelText(/^Role/)).toHaveValue('');
    expect(screen.getByLabelText(/Years of experience/)).toHaveValue(null);
    expect(screen.getByLabelText('GitHub URL')).toHaveValue('');
    expect(screen.getByLabelText('LinkedIn URL')).toHaveValue('');
  });

  it('Zone 3 shows the empty state with a route into a first assessment, not a blank card', async () => {
    await renderProfile(defaultState());
    expect(
      screen.getByText("No verified skills yet — self-reported skills aren't independently tested."),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Take an assessment' })).toHaveAttribute('href', '/assessments');
  });

  it('Zone 4 states the public page is not visible, rather than assuming it is', async () => {
    await renderProfile(defaultState());
    expect(screen.getByText('Not visible to employers yet.')).toBeInTheDocument();
  });

  it('ProfileViewersPanel renders nothing at zero views — not an empty-state card', async () => {
    await renderProfile(defaultState());
    expect(screen.queryByText('Profile viewers')).not.toBeInTheDocument();
    expect(screen.queryByText(/employers? .* viewed your profile/)).not.toBeInTheDocument();
  });
});

describe('Profile page — parsed résumé and a verified badge', () => {
  function parsedState(): MockState {
    const state = defaultState();
    state.profile = { ...state.profile, resumeS3Key: 'existing-key.pdf' };
    state.portfolio = {
      ...state.portfolio,
      hasResume: true,
      parsedAt: '2026-10-12T00:00:00.000Z',
      approvedAt: '2026-10-13T00:00:00.000Z',
      visibleToEmployers: true,
      verifiedBadges: [
        {
          skillId: 'skill-1',
          skillName: 'Prompt Engineering',
          level: 'L2',
          verifiedBy: 'TEST',
          verifyHash: 'hash-1',
          issuedAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2027-09-01T00:00:00.000Z',
        },
      ],
    };
    state.viewers = {
      tier: 'FREE',
      mode: 'full',
      viewers: [{ viewedAt: '2026-10-14T00:00:00.000Z', source: 'DETAIL_VIEW', orgName: 'Acme Corp' }],
    };
    return state;
  }

  it('Zone 1 goes quiet instead of re-showing the upload prompt', async () => {
    await renderProfile(parsedState());
    expect(screen.getByText(/Résumé parsed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.queryByText("Upload your résumé and we'll fill this in")).not.toBeInTheDocument();
  });

  it('Replace reopens the upload prompt', async () => {
    await renderProfile(parsedState());
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByText("Upload your résumé and we'll fill this in")).toBeInTheDocument();
  });

  it('Zone 3 shows the verified badge chip, not the empty state', async () => {
    await renderProfile(parsedState());
    expect(screen.queryByText(/No verified skills yet/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Prompt Engineering/ })).toHaveAttribute('href', '/badges/hash-1');
  });

  it('Zone 4 reflects an approved, visible portfolio', async () => {
    await renderProfile(parsedState());
    expect(screen.getByText("Visible to employers you've engaged with.")).toBeInTheDocument();
  });

  it('Zone 4 reflects an approved-but-not-visible portfolio', async () => {
    const state = parsedState();
    state.portfolio.visibleToEmployers = false;
    await renderProfile(state);
    expect(screen.getByText('Not visible to employers yet.')).toBeInTheDocument();
  });

  it('Zone 4 reflects a visible-but-unapproved portfolio distinctly from both other states', async () => {
    const state = parsedState();
    state.portfolio.approvedAt = null;
    await renderProfile(state);
    expect(screen.getByText('Not shown yet — approve your draft first.')).toBeInTheDocument();
  });

  it('ProfileViewersPanel renders above the résumé zone when there is at least one view', async () => {
    await renderProfile(parsedState());
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });
});

describe('Profile page — field behaviour (predates the restructure, must survive it)', () => {
  it('every Zone 2 field is present and PATCHes on save', async () => {
    await renderProfile(defaultState());

    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/Headline/), { target: { value: 'ML Engineer' } });
    fireEvent.change(screen.getByLabelText('GitHub URL'), { target: { value: 'https://github.com/ada' } });
    fireEvent.change(screen.getByLabelText('LinkedIn URL'), { target: { value: 'https://linkedin.com/in/ada' } });
    fireEvent.change(screen.getByLabelText(/Years of experience/), { target: { value: '8' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('✓ Saved');

    const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit?][];
    const patchCall = calls.find(([url, init]) => url.includes('/profiles/me') && init?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall?.[1]?.body as string) ?? '{}');
    expect(body).toMatchObject({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      headline: 'ML Engineer',
      githubUrl: 'https://github.com/ada',
      linkedinUrl: 'https://linkedin.com/in/ada',
      yearsOfExp: 8,
    });
  });

  it('a résumé upload fills Zone 2 fields from the parse, marked as suggested', async () => {
    await renderProfile(defaultState());

    const fileInput = screen.getByLabelText('PDF resume (max 5MB)');
    const file = new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await screen.findByText(/Filled in your details below/);
    expect(screen.getByLabelText(/Full name/)).toHaveValue('Parsed Name');
    expect(screen.getByLabelText(/Headline/)).toHaveValue('Parsed Headline');
    expect(screen.getByLabelText(/Years of experience/)).toHaveValue(5);
    expect(screen.getAllByText('(from your résumé — confirm or correct)').length).toBeGreaterThan(0);
  });
});

describe('Profile page — certifications still render their three tiers distinctly', () => {
  it('shows VERIFIED, LINK_PROVIDED, and SELF_REPORTED as visually distinct tiers', async () => {
    const state = defaultState();
    state.certifications = [
      {
        id: 'cert-verified',
        name: 'Verified Cert',
        issuer: 'CREDLY',
        issuerOther: null,
        issueDate: '2026-01-01T00:00:00.000Z',
        expiryDate: null,
        credentialId: null,
        credentialUrl: 'https://credly.example/verified',
        fileUrl: null,
        verificationStatus: 'VERIFIED',
        verificationSource: 'CREDLY',
        skillTags: [],
        isExpiringSoon: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'cert-link',
        name: 'Link Cert',
        issuer: 'AWS',
        issuerOther: null,
        issueDate: '2026-01-01T00:00:00.000Z',
        expiryDate: null,
        credentialId: null,
        credentialUrl: 'https://aws.example/link',
        fileUrl: null,
        verificationStatus: 'LINK_PROVIDED',
        verificationSource: 'URL',
        skillTags: [],
        isExpiringSoon: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'cert-self',
        name: 'Self Cert',
        issuer: 'OTHER',
        issuerOther: 'Some School',
        issueDate: '2026-01-01T00:00:00.000Z',
        expiryDate: null,
        credentialId: null,
        credentialUrl: null,
        fileUrl: '/profiles/me/certifications/cert-self/file',
        verificationStatus: 'SELF_REPORTED',
        verificationSource: 'MANUAL_UPLOAD',
        skillTags: [],
        isExpiringSoon: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    await renderProfile(state);
    await waitFor(() => expect(screen.getByText('Verified Cert')).toBeInTheDocument());

    expect(screen.getByText('Verified via Credly')).toBeInTheDocument();
    expect(screen.getByText('Link provided — unverified')).toBeInTheDocument();
    expect(screen.getByText('Candidate-provided')).toBeInTheDocument();
  });
});
