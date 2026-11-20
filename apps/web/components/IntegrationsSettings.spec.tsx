import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IntegrationsSettings from './IntegrationsSettings';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const overview = (webhooks: unknown[] = []) => ({
  availableEvents: ['candidate.applied', 'pipeline.stage_changed', 'outreach.interested', 'job.status_changed'],
  webhooks,
  apiKeys: [{ id: 'k1', name: 'Zoho sync', prefix: 'mya_AbCdEfGh', lastUsedAt: null, createdAt: '2026-11-20T00:00:00Z' }],
});

describe('IntegrationsSettings', () => {
  it('adds a webhook with the chosen events and shows the signing secret once', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith('/integrations/webhooks') && init?.method === 'POST') {
        return jsonResponse(201, { id: 'h1', url: 'https://hooks.example.com/x', events: ['candidate.applied'], active: true, secret: 'whsec_TOPSECRET' });
      }
      return jsonResponse(200, overview());
    }) as unknown as typeof fetch;

    render(<IntegrationsSettings />);
    await waitFor(() => expect(screen.getByText('Zoho sync')).toBeInTheDocument());
    expect(screen.getByText('mya_AbCdEfGh…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add webhook' }));
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'https://hooks.example.com/x' } });
    // All events start ticked; untick three.
    fireEvent.click(screen.getByLabelText(/moves stage/));
    fireEvent.click(screen.getByLabelText(/says Interested/));
    fireEvent.click(screen.getByLabelText(/posted, closed/));
    fireEvent.click(screen.getByRole('button', { name: 'Save webhook' }));

    await waitFor(() => expect(screen.getByText('whsec_TOPSECRET')).toBeInTheDocument());
    const post = calls.find(([u, i]) => u.endsWith('/integrations/webhooks') && i?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ url: 'https://hooks.example.com/x', events: ['candidate.applied'] });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('whsec_TOPSECRET')).not.toBeInTheDocument();
  });

  it('shows why an endpoint was switched off', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(async () =>
      jsonResponse(200, overview([{ id: 'h1', url: 'https://hooks.example.com/x', events: ['candidate.applied'], active: false, disabledReason: 'Switched off after 20 failed deliveries in a row.', consecutiveFailures: 20, lastDeliveryAt: null, createdAt: '2026-11-20T00:00:00Z' }])),
    ) as unknown as typeof fetch;
    render(<IntegrationsSettings />);
    await waitFor(() => expect(screen.getByText(/Switched off after 20/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send test event' })).toBeDisabled();
  });
});
