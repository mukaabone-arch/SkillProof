import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OutreachInbox from './OutreachInbox';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const opp = {
  id: 'm1',
  orgName: 'Acme',
  fromRecruiter: false,
  job: { id: 'j1', title: 'ML Engineer', live: true, employmentType: 'FULL_TIME', remote: true, location: 'Pune', salary: null },
  body: 'Hi Priya,\n\nYour verified Python stood out.',
  status: 'SENT',
  sentAt: '2026-11-17T00:00:00Z',
  respondedAt: null,
  candidateNote: null,
  canRespond: true,
};

describe('OutreachInbox', () => {
  it('renders nothing when empty (Interviews page), but explains itself on Opportunities', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () => jsonResponse(200, [])) as unknown as typeof fetch;
    const { container, unmount } = render(<OutreachInbox />);
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBe(1));
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(<OutreachInbox showEmpty />);
    await waitFor(() => expect(screen.getByText(/No messages yet/)).toBeInTheDocument());
  });

  it('Interested sends the reply with the note and moves the message to earlier', async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/respond')) return jsonResponse(200, { status: 'INTERESTED', respondedAt: '2026-11-18T00:00:00Z', candidateNote: 'From Jan' });
      return jsonResponse(200, [opp]);
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    render(<OutreachInbox />);
    await waitFor(() => expect(screen.getByText('ML Engineer')).toBeInTheDocument());
    expect(screen.getByText(/Your verified Python stood out/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Add a note/), { target: { value: 'From Jan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Interested — share my contact details' }));

    await waitFor(() => expect(screen.getByText('Earlier messages (1)')).toBeInTheDocument());
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/outreach/me/m1/respond'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ response: 'INTERESTED', note: 'From Jan' });
    expect(screen.getByText('You said Interested')).toBeInTheDocument();
  });
});
