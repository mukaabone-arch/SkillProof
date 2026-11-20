'use client';

/**
 * Settings → Integrations (admins, verified orgs). Webhooks send signed
 * JSON events to the org's own systems (an ATS, Zapier, a script); API
 * keys let those systems read jobs, applicants and the pipeline and move
 * candidates on. Secrets and keys are shown once, when created. The full
 * reference is the public /developers page.
 */
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import { Badge, ErrorState } from '@/components/ui';

const { api } = employerApi;

export const EVENT_LABEL: Record<string, string> = {
  'candidate.applied': 'A candidate applies to a job',
  'pipeline.stage_changed': 'A candidate moves stage on the shortlist',
  'outreach.interested': 'A candidate says Interested to AI sourcing',
  'submission.status_changed': 'A submission to a client changes status',
  'job.status_changed': 'A job is posted, closed or reopened',
};

interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  createdAt: string;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Overview {
  availableEvents: string[];
  webhooks: Webhook[];
  apiKeys: ApiKey[];
}

interface Delivery {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
  nextAttemptAt: string | null;
}

interface AttemptResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

function when(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function OneTimeSecret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="integrations-secret" role="status">
      <strong>{label}</strong>
      <p className="meta" style={{ margin: '2px 0 6px' }}>Copy it now. For security it won&apos;t be shown again.</p>
      <code>{value}</code>
      <div className="row" style={{ margin: '8px 0 0' }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

export default function IntegrationsSettings() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [form, setForm] = useState<{ url: string; events: string[] } | null>(null);
  const [keyName, setKeyName] = useState('');
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  function load() {
    api<Overview>('/integrations')
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }
  useEffect(load, []);

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function addWebhook(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const r = await run('add', () => api<Webhook & { secret: string }>('/integrations/webhooks', { method: 'POST', body: JSON.stringify(form) }));
    if (r) {
      setForm(null);
      setSecret({ label: 'Signing secret for this webhook', value: r.secret });
      load();
    }
  }

  async function test(h: Webhook) {
    const r = await run(`test-${h.id}`, () => api<AttemptResult>(`/integrations/webhooks/${h.id}/test`, { method: 'POST' }));
    if (r) {
      setNotice(r.ok ? `Test event delivered (HTTP ${r.status}).` : `Test event failed: ${r.error ?? 'no response'}.`);
      load();
      if (openDeliveries === h.id) void showDeliveries(h.id, true);
    }
  }

  async function showDeliveries(id: string, force = false) {
    if (openDeliveries === id && !force) {
      setOpenDeliveries(null);
      return;
    }
    const r = await run(`log-${id}`, () => api<Delivery[]>(`/integrations/webhooks/${id}/deliveries`));
    if (r) {
      setDeliveries(r);
      setOpenDeliveries(id);
    }
  }

  async function redeliver(webhookId: string, deliveryId: string) {
    const r = await run(`re-${deliveryId}`, () => api<AttemptResult>(`/integrations/deliveries/${deliveryId}/redeliver`, { method: 'POST' }));
    if (r) {
      setNotice(r.ok ? 'Sent again successfully.' : `Still failing: ${r.error ?? 'no response'}.`);
      void showDeliveries(webhookId, true);
    }
  }

  async function update(h: Webhook, patch: Partial<Pick<Webhook, 'active'>>) {
    const r = await run(`upd-${h.id}`, () => api<Webhook>(`/integrations/webhooks/${h.id}`, { method: 'PATCH', body: JSON.stringify(patch) }));
    if (r) load();
  }

  async function rotate(h: Webhook) {
    if (!window.confirm('Create a new signing secret? The old one stops working immediately, so update your receiver straight away.')) return;
    const r = await run(`rot-${h.id}`, () => api<{ secret: string }>(`/integrations/webhooks/${h.id}/rotate-secret`, { method: 'POST' }));
    if (r) setSecret({ label: 'New signing secret', value: r.secret });
  }

  async function remove(h: Webhook) {
    if (!window.confirm(`Delete the webhook to ${h.url}? Its delivery log is deleted too.`)) return;
    const r = await run(`del-${h.id}`, () => api(`/integrations/webhooks/${h.id}`, { method: 'DELETE' }));
    if (r !== undefined) load();
  }

  async function createKey(e: FormEvent) {
    e.preventDefault();
    const r = await run('key', () => api<ApiKey & { key: string }>('/integrations/api-keys', { method: 'POST', body: JSON.stringify({ name: keyName }) }));
    if (r) {
      setKeyName('');
      setSecret({ label: `API key "${r.name}"`, value: r.key });
      load();
    }
  }

  async function revoke(k: ApiKey) {
    if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`)) return;
    const r = await run(`rev-${k.id}`, () => api(`/integrations/api-keys/${k.id}`, { method: 'DELETE' }));
    if (r !== undefined) load();
  }

  if (!data) return error ? <ErrorState message={error} onRetry={load} /> : <p className="meta">Loading…</p>;

  return (
    <div className="integrations">
      <p className="meta" style={{ marginTop: 0 }}>
        Connect MyAmbii to your applicant tracking system or other tools. See the{' '}
        <Link href="/developers" target="_blank" rel="noopener noreferrer">API and webhook guide</Link> for payloads, signatures and endpoints.
      </p>
      {secret && <OneTimeSecret label={secret.label} value={secret.value} onDone={() => setSecret(null)} />}
      {error && <ErrorState message={error} />}
      {notice && <p className="ok" role="status">{notice}</p>}

      <h3>Webhooks</h3>
      <p className="meta">MyAmbii sends a signed JSON message to your URL when something happens, with the candidate&apos;s verified skills and, where they&apos;ve agreed, contact details.</p>
      {data.webhooks.length === 0 && !form && <p className="meta">No webhooks yet.</p>}
      {data.webhooks.map((h) => (
        <div key={h.id} className="card integrations-item">
          <div className="row" style={{ justifyContent: 'space-between', margin: 0, flexWrap: 'wrap', gap: 8 }}>
            <code className="integrations-url">{h.url}</code>
            <Badge variant={h.active ? 'verified' : 'neutral'}>{h.active ? 'On' : 'Off'}</Badge>
          </div>
          <div className="integrations-events">
            {h.events.map((e) => (
              <span key={e} title={EVENT_LABEL[e]}>{e}</span>
            ))}
          </div>
          {h.disabledReason && <p className="error" style={{ margin: 0 }}>{h.disabledReason}</p>}
          <p className="meta" style={{ margin: 0 }}>
            Last delivery: {when(h.lastDeliveryAt)}
            {h.consecutiveFailures > 0 && ` · ${h.consecutiveFailures} failed in a row`}
          </p>
          <div className="row" style={{ margin: 0, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary btn-small" disabled={!!busy || !h.active} onClick={() => test(h)}>
              {busy === `test-${h.id}` ? 'Sending…' : 'Send test event'}
            </button>
            <button type="button" className="btn-secondary btn-small" disabled={!!busy} onClick={() => showDeliveries(h.id)}>
              {openDeliveries === h.id ? 'Hide deliveries' : 'Recent deliveries'}
            </button>
            <button type="button" className="btn-secondary btn-small" disabled={!!busy} onClick={() => update(h, { active: !h.active })}>
              {h.active ? 'Turn off' : 'Turn on'}
            </button>
            <button type="button" className="btn-secondary btn-small" disabled={!!busy} onClick={() => rotate(h)}>New secret</button>
            <button type="button" className="btn-secondary btn-small" disabled={!!busy} onClick={() => remove(h)}>Delete</button>
          </div>
          {openDeliveries === h.id && (
            <div className="admin-table-wrap">
              {deliveries.length === 0 ? (
                <p className="meta">Nothing sent yet.</p>
              ) : (
                <table className="admin-table integrations-log">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Result</th>
                      <th>Attempts</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d) => (
                      <tr key={d.id}>
                        <td><code>{d.event}</code></td>
                        <td>
                          <Badge variant={d.status === 'SUCCEEDED' ? 'verified' : d.status === 'FAILED' ? 'danger' : 'warning'}>
                            {d.status === 'SUCCEEDED' ? `Delivered${d.responseStatus ? ` (${d.responseStatus})` : ''}` : d.status === 'FAILED' ? 'Failed' : 'Retrying'}
                          </Badge>
                          {d.error && <div className="meta">{d.error}</div>}
                          {d.status === 'PENDING' && d.nextAttemptAt && <div className="meta">Next try {when(d.nextAttemptAt)}</div>}
                          {d.status !== 'SUCCEEDED' && h.active && (
                            <button type="button" className="btn-link" disabled={!!busy} onClick={() => redeliver(h.id, d.id)}>Send again now</button>
                          )}
                        </td>
                        <td>{d.attempts}</td>
                        <td>{when(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}

      {form ? (
        <form className="card integrations-item" onSubmit={addWebhook}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="hook-url">Endpoint URL</label>
            <input id="hook-url" type="url" required placeholder="https://your-system.example.com/myambii" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </div>
          <fieldset className="integrations-checks">
            <legend>Send these events</legend>
            {data.availableEvents.map((ev) => (
              <label key={ev}>
                <input
                  type="checkbox"
                  checked={form.events.includes(ev)}
                  onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter((x) => x !== ev) })}
                />
                <span>
                  {EVENT_LABEL[ev] ?? ev} <code className="meta">{ev}</code>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="row" style={{ margin: 0 }}>
            <button type="submit" disabled={!form.url || form.events.length === 0 || busy === 'add'}>{busy === 'add' ? 'Saving…' : 'Save webhook'}</button>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setForm({ url: '', events: [...data.availableEvents] })}>+ Add webhook</button>
      )}

      <h3>API keys</h3>
      <p className="meta">Let your own systems read jobs, applicants and the pipeline, and move candidates on. Treat a key like a password.</p>
      {data.apiKeys.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Last used</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.apiKeys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td><code>{k.prefix}…</code></td>
                  <td>{when(k.lastUsedAt)}</td>
                  <td>{when(k.createdAt)}</td>
                  <td>
                    <button type="button" className="btn-link" disabled={!!busy} onClick={() => revoke(k)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="row integrations-keyform" onSubmit={createKey}>
        <label className="visually-hidden" htmlFor="key-name">Key name</label>
        <input id="key-name" maxLength={60} placeholder="Name, e.g. Zoho Recruit sync" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
        <button type="submit" className="btn-secondary" disabled={!keyName.trim() || busy === 'key'}>{busy === 'key' ? 'Creating…' : 'Create API key'}</button>
      </form>
    </div>
  );
}
