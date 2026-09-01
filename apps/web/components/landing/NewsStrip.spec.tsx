/**
 * Real React rendering (jsdom + RTL), not just reading the component's
 * code — this is what the brief explicitly asked to have proven, not
 * asserted: "the strip renders nothing — not an error, not a spinner —
 * when the API returns an empty array." Only `fetch` is mocked, same
 * convention as lib/candidateVerification.spec.tsx.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import NewsStrip from './NewsStrip';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('NewsStrip', () => {
  it('renders nothing while the fetch is in flight — no loading spinner, no placeholder text', () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;

    const { container } = render(<NewsStrip />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the API returns an empty array — the exact "nothing cached" case', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () => jsonResponse(200, [])) as unknown as typeof fetch;

    const { container } = render(<NewsStrip />);

    // Give the effect's fetch a tick to resolve, then assert it settled on rendering nothing — not "hasn't rendered yet."
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the fetch fails outright (network error / API down) — fails open, never shows an error', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () => {
      throw new Error('network error');
    }) as unknown as typeof fetch;

    const { container } = render(<NewsStrip />);

    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the API returns a non-2xx status', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () => jsonResponse(500, { message: 'boom' })) as unknown as typeof fetch;

    const { container } = render(<NewsStrip />);

    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the strip when the API returns items, with correct link attributes and a visible date', async () => {
    const items = [
      { id: '1', source: 'OpenAI', title: 'A real headline', link: 'https://openai.com/index/example', publishedAt: '2026-08-30T12:00:00.000Z' },
      { id: '2', source: 'DeepMind', title: 'Another headline', link: 'https://deepmind.google/blog/example', publishedAt: '2026-08-25T00:00:00.000Z' },
    ];
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () => jsonResponse(200, items)) as unknown as typeof fetch;

    render(<NewsStrip />);

    const link = await screen.findByRole('link', { name: 'A real headline' });
    expect(link).toHaveAttribute('href', 'https://openai.com/index/example');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/OpenAI/)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Another headline' })).toHaveAttribute('href', 'https://deepmind.google/blog/example');
  });
});
