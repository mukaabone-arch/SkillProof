/**
 * Real React rendering (jsdom + RTL) — only `fetch` is mocked, lib/api.ts is
 * the real module (same convention as EmployerJobMatches.spec.tsx).
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmployerOutreachCampaign, { sendSummary } from './EmployerOutreachCampaign';

jest.mock('./StaffingSubmitToClient', () => ({
  __esModule: true,
  default: () => <button>Submit to client</button>,
}));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const msg = (over: Record<string, unknown>) => ({
  id: 'm1',
  candidateId: 'p1',
  candidate: { ref: 'C-AAAAAA', name: 'Priya Sharma', headline: 'ML engineer', roleTitle: null, roleTitleOther: null, yearsOfExp: 4, location: 'Pune, IN' },
  contact: null,
  score: 85,
  matchReason: 'Verified L3 Python',
  body: 'Hi Priya, a role for you.',
  status: 'DRAFT',
  sentAt: null,
  followUpsSent: 0,
  nextFollowUpAt: null,
  respondedAt: null,
  candidateNote: null,
  shortlistEntryId: null,
  ...over,
});

const campaign = (over: Record<string, unknown> = {}) => ({
  id: 'camp1',
  status: 'ACTIVE',
  createdAt: '2026-11-17T00:00:00Z',
  followUpDays: [3, 7],
  job: { id: 'j1', title: 'ML Engineer', status: 'LIVE', client: null, projectRoleId: null },
  anonymised: false,
  limits: { dailyLimit: 50, sentToday: 0, remainingToday: 50 },
  counts: { drafts: 1, skipped: 0, sent: 1, awaiting: 0, interested: 1, notNow: 0, notInterested: 0, stopped: 0 },
  messages: [
    msg({}),
    msg({
      id: 'm2',
      candidateId: 'p2',
      candidate: { ref: 'C-BBBBBB', name: 'Arjun Rao', headline: null, roleTitle: null, roleTitleOther: null, yearsOfExp: null, location: null },
      status: 'INTERESTED',
      contact: { email: 'arjun@example.com', phone: null },
      candidateNote: 'Free from January',
      shortlistEntryId: 'e1',
      respondedAt: '2026-11-18T00:00:00Z',
    }),
  ],
  ...over,
});

describe('EmployerOutreachCampaign', () => {
  it('shows drafts for review, then sends and reports what happened', async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/send') && init?.method === 'POST') return jsonResponse(200, { sent: 1, heldDailyLimit: 0, heldWeeklyLimit: 0, skipped: 0 });
      return jsonResponse(200, campaign());
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    render(<EmployerOutreachCampaign campaignId="camp1" />);
    await waitFor(() => expect(screen.getByText('Review 1 draft')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Hi Priya, a role for you.')).toBeInTheDocument();
    expect(screen.getByText('Verified L3 Python')).toBeInTheDocument();
    // Interested candidate: contact details, note, and the shortlist link.
    expect(screen.getByText('arjun@example.com')).toBeInTheDocument();
    expect(screen.getByText('“Free from January”')).toBeInTheDocument();
    expect(screen.getByText(/On this job’s shortlist/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send 1 message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 message sent.'));
  });

  it('recruiters see anonymous refs and a submit-to-client action', async () => {
    const anon = campaign({
      anonymised: true,
      messages: [msg({ candidate: { ref: 'C-AAAAAA', name: null, headline: null, roleTitle: null, roleTitleOther: null, yearsOfExp: 4, location: 'Pune' } })],
    });
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () => jsonResponse(200, anon)) as unknown as typeof fetch;
    render(<EmployerOutreachCampaign campaignId="camp1" />);
    await waitFor(() => expect(screen.getByText('Candidate C-AAAAAA')).toBeInTheDocument());
    expect(screen.getByText(/stay anonymous until they say Interested/)).toBeInTheDocument();
  });

  it('explains held messages in plain words', () => {
    expect(sendSummary({ sent: 2, heldDailyLimit: 1, heldWeeklyLimit: 1, skipped: 1 })).toBe(
      '2 messages sent. 1 held because the candidate has reached their weekly message limit — try again in a few days. ' +
        '1 held by your daily limit — they’ll stay as drafts until tomorrow. 1 left out because the candidate no longer accepts messages.',
    );
  });
});
