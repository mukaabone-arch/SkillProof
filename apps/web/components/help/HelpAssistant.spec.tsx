/**
 * Real React rendering (jsdom + RTL); only `fetch` is mocked, same
 * convention as CandidateNav.spec.tsx.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HelpAssistant from './HelpAssistant';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const calls: { url: string; body: any }[] = [];

function mockFetch(reply: (body: any) => [number, unknown]) {
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(input), body });
    const [status, json] = reply(body);
    return jsonResponse(status, json);
  }) as unknown as typeof fetch;
}

const ANSWER = {
  id: 'hq-1',
  answer: 'Take a skill check from Assessments.\n\n- Pick a skill\n- Pass the test',
  covered: true,
  sources: [{ id: 'assessments', label: 'Taking an assessment' }],
  guidePath: '/help/candidate',
};

function renderPanel(props: Partial<React.ComponentProps<typeof HelpAssistant>> = {}) {
  return render(<HelpAssistant open onClose={jest.fn()} audience="candidate" client="candidate" {...props} />);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls.length = 0;
  localStorage.setItem('sp_token', 'candidate-token');
  localStorage.setItem('sp_emp_token', 'employer-token');
  Element.prototype.scrollTo = jest.fn();
});

describe('HelpAssistant', () => {
  it('asks for agreement first, then shows the starter questions', async () => {
    mockFetch(() => [200, ANSWER]);
    renderPanel();

    expect(screen.getByText(/sent to our AI provider, Anthropic/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Agree and continue' }));
    expect(screen.getByLabelText('Your question')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'How do I get my first verified badge?' })).toBeInTheDocument();
    expect(localStorage.getItem('myambii-help-ai-ok')).toBe('true');
  });

  it('sends the question, shows the answer with its guide link and a report control', async () => {
    localStorage.setItem('myambii-help-ai-ok', 'true');
    mockFetch(() => [200, ANSWER]);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'How do I get a badge?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText(/Take a skill check from Assessments/)).toBeInTheDocument());
    expect(calls[0].url).toMatch(/\/help\/ask$/);
    expect(calls[0].body).toEqual({ messages: [{ role: 'user', content: 'How do I get a badge?' }], platform: 'web' });
    expect(screen.getByRole('link', { name: 'Taking an assessment' })).toHaveAttribute('href', '/help/candidate#assessments');
    expect(screen.getByRole('button', { name: 'Report this AI-generated response' })).toBeInTheDocument();
  });

  it('sends earlier turns with a follow-up, and uses the employer session on employer pages', async () => {
    localStorage.setItem('myambii-help-ai-ok', 'true');
    mockFetch(() => [200, { ...ANSWER, guidePath: '/help/employer', sources: [] }]);
    renderPanel({ audience: 'employer', client: 'employer' });

    fireEvent.click(screen.getByRole('button', { name: 'How do I add a colleague?' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await screen.findByText(/Take a skill check/);

    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'And remove one?' } });
    fireEvent.keyDown(screen.getByLabelText('Your question'), { key: 'Enter' });
    await waitFor(() => expect(calls).toHaveLength(2));

    expect(calls[1].body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    const init = (global.fetch as jest.Mock).mock.calls[1][1] as RequestInit;
    expect(JSON.stringify(init.headers)).toContain('employer-token');
  });

  it('on an error puts the question back in the box and keeps the conversation alternating', async () => {
    localStorage.setItem('myambii-help-ai-ok', 'true');
    mockFetch(() => [429, { message: "You've reached today's limit for help questions." }]);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'One more?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("today's limit"));
    expect(screen.getByLabelText('Your question')).toHaveValue('One more?');
    expect(JSON.parse(sessionStorage.getItem('myambii-help-chat-candidate') ?? '[]')).toEqual([]);
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    renderPanel({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
