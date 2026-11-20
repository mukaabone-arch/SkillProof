'use client';

/**
 * One AI sourcing campaign: review the drafted messages (edit, leave
 * someone out), send them, then follow each candidate's reply. Contact
 * details appear once a candidate says Interested; an employer's
 * interested candidates are already on the job's shortlist, a recruiter
 * submits theirs to the client from here. Recruiters see candidates
 * anonymised until then (the same rule as Find talent).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import { Badge, ErrorState, LoadingState } from '@/components/ui';
import { matchBand, MATCH_BAND_LABELS, MATCH_BAND_VARIANTS } from '@/lib/matchBand';
import {
  CAMPAIGN_STATUS_LABEL,
  CampaignDetail,
  CampaignMessage,
  MESSAGE_STATUS_LABEL,
  MESSAGE_STATUS_VARIANT,
  SendResult,
  formatShortDate,
} from '@/lib/outreach';
import StaffingSubmitToClient from './StaffingSubmitToClient';
import AtsDownloadButton from './AtsDownloadButton';

const { api } = employerApi;

function candidateLabel(m: CampaignMessage): string {
  return m.candidate.name || `Candidate ${m.candidate.ref}`;
}

function candidateFacts(m: CampaignMessage): string {
  const role = m.candidate.roleTitleOther || (m.candidate.roleTitle ? m.candidate.roleTitle.replace(/_/g, ' ').toLowerCase() : null);
  return [m.candidate.headline || role, m.candidate.location, m.candidate.yearsOfExp != null ? `${m.candidate.yearsOfExp} yrs` : null]
    .filter(Boolean)
    .join(' · ');
}

export function sendSummary(r: SendResult): string {
  const parts = [`${r.sent} message${r.sent === 1 ? '' : 's'} sent.`];
  if (r.heldWeeklyLimit) parts.push(`${r.heldWeeklyLimit} held because the candidate has reached their weekly message limit — try again in a few days.`);
  if (r.heldDailyLimit) parts.push(`${r.heldDailyLimit} held by your daily limit — they’ll stay as drafts until tomorrow.`);
  if (r.skipped) parts.push(`${r.skipped} left out because the candidate no longer accepts messages.`);
  return parts.join(' ');
}

export default function EmployerOutreachCampaign({ campaignId }: { campaignId: string }) {
  const [c, setC] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  function load() {
    setError('');
    api<CampaignDetail>(`/outreach/campaigns/${campaignId}`)
      .then(setC)
      .catch((e) => setError((e as Error).message));
  }

  useEffect(load, [campaignId]);

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

  async function saveBody(m: CampaignMessage) {
    const body = edits[m.id];
    if (body === undefined || body.trim() === m.body || !body.trim()) return;
    const r = await run(`save-${m.id}`, () =>
      api<{ body: string }>(`/outreach/campaigns/${campaignId}/messages/${m.id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
    );
    if (r) {
      setC((cur) => (cur ? { ...cur, messages: cur.messages.map((x) => (x.id === m.id ? { ...x, body: r.body } : x)) } : cur));
      setEdits((e) => {
        const { [m.id]: _drop, ...rest } = e;
        return rest;
      });
    }
  }

  async function toggleSkip(m: CampaignMessage) {
    const skip = m.status === 'DRAFT';
    const r = await run(`skip-${m.id}`, () =>
      api<{ status: CampaignMessage['status'] }>(`/outreach/campaigns/${campaignId}/messages/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ skip }),
      }),
    );
    if (r) load();
  }

  async function sendAll() {
    // Save any message still being edited first, so what's sent is what's on screen.
    for (const m of c?.messages ?? []) if (edits[m.id] !== undefined) await saveBody(m);
    const r = await run('send', () => api<SendResult>(`/outreach/campaigns/${campaignId}/send`, { method: 'POST', body: '{}' }));
    if (r) {
      load();
      setNotice(sendSummary(r));
    }
  }

  async function findMore() {
    const r = await run('more', () => api<{ added: number; campaign: CampaignDetail }>(`/outreach/campaigns/${campaignId}/find-more`, { method: 'POST' }));
    if (r) {
      setC(r.campaign);
      setNotice(r.added ? `${r.added} more candidate${r.added === 1 ? '' : 's'} drafted.` : 'No new candidates match right now. Check back as more people verify their skills.');
    }
  }

  async function setStatus(status: 'ACTIVE' | 'PAUSED' | 'CLOSED') {
    const r = await run(`status-${status}`, () =>
      api<CampaignDetail>(`/outreach/campaigns/${campaignId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    );
    if (r) setC(r);
  }

  if (!c) {
    return error ? <ErrorState message={error} onRetry={load} /> : <LoadingState message="Loading campaign…" />;
  }

  const drafts = c.messages.filter((m) => m.status === 'DRAFT');
  const skipped = c.messages.filter((m) => m.status === 'SKIPPED');
  const sent = c.messages.filter((m) => !['DRAFT', 'SKIPPED'].includes(m.status));
  const interested = sent.filter((m) => m.status === 'INTERESTED');
  const others = sent.filter((m) => m.status !== 'INTERESTED');
  const closed = c.status === 'CLOSED';
  const canSend = c.status === 'ACTIVE' && drafts.length > 0;

  return (
    <div className="outreach-campaign">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', margin: 0, gap: 12 }}>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>AI sourcing</p>
          <h1 style={{ margin: '4px 0' }}>{c.job.title}</h1>
          <p className="meta" style={{ margin: 0 }}>
            <Badge variant={c.status === 'ACTIVE' ? 'default' : 'neutral'}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>{' '}
            Started {formatShortDate(c.createdAt)} · follow-ups after {c.followUpDays.join(' and ')} days
          </p>
        </div>
        <div className="row" style={{ margin: 0, flexWrap: 'wrap' }}>
          <Link href="/employer/outreach" className="btn btn-secondary">All campaigns</Link>
          {!closed && (
            <button className="btn-secondary" onClick={findMore} disabled={!!busy}>
              {busy === 'more' ? 'Searching…' : 'Find more candidates'}
            </button>
          )}
          {c.status === 'ACTIVE' && (
            <button className="btn-secondary" onClick={() => setStatus('PAUSED')} disabled={!!busy}>Pause</button>
          )}
          {c.status === 'PAUSED' && (
            <button className="btn-secondary" onClick={() => setStatus('ACTIVE')} disabled={!!busy}>Resume</button>
          )}
          {!closed && (
            <button className="btn-secondary" onClick={() => setStatus('CLOSED')} disabled={!!busy} title="Stops follow-ups; candidates can no longer reply">
              Close
            </button>
          )}
        </div>
      </div>

      <div className="outreach-tiles">
        <Tile label="Drafts" value={c.counts.drafts} />
        <Tile label="Sent" value={c.counts.sent} />
        <Tile label="Interested" value={c.counts.interested} strong />
        <Tile label="Not now" value={c.counts.notNow} />
        <Tile label="Not for them" value={c.counts.notInterested} />
        <Tile label="Awaiting reply" value={c.counts.awaiting} />
      </div>

      {error && <ErrorState message={error} />}
      {notice && <p className="outreach-notice" role="status">{notice}</p>}
      {c.anonymised && (
        <p className="meta">Candidates stay anonymous until they say Interested; then you see their name and contact details.</p>
      )}

      {drafts.length > 0 && (
        <section className="outreach-section">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', margin: 0 }}>
            <div>
              <h2 style={{ margin: 0 }}>Review {drafts.length} draft{drafts.length === 1 ? '' : 's'}</h2>
              <p className="meta" style={{ margin: '4px 0 0' }}>
                Edit any message or leave someone out. You can send {c.limits.remainingToday} more today ({c.limits.dailyLimit} a day).
              </p>
            </div>
            <button onClick={sendAll} disabled={!canSend || !!busy}>
              {busy === 'send' ? 'Sending…' : `Send ${drafts.length} message${drafts.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {c.status === 'PAUSED' && <p className="meta">Resume the campaign to send.</p>}
          {drafts.map((m) => {
            const band = matchBand(m.score);
            return (
              <div key={m.id} className="card outreach-draft">
                <div className="row" style={{ justifyContent: 'space-between', margin: 0, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong>{candidateLabel(m)}</strong> <Badge variant={MATCH_BAND_VARIANTS[band]}>{MATCH_BAND_LABELS[band]}</Badge>
                    <div className="meta">{candidateFacts(m)}</div>
                  </div>
                  <button className="btn-secondary btn-small" onClick={() => toggleSkip(m)} disabled={!!busy}>Leave out</button>
                </div>
                <p className="outreach-reason">{m.matchReason}</p>
                <label className="visually-hidden" htmlFor={`msg-${m.id}`}>Message to {candidateLabel(m)}</label>
                <textarea
                  id={`msg-${m.id}`}
                  rows={8}
                  maxLength={1200}
                  value={edits[m.id] ?? m.body}
                  onChange={(e) => setEdits({ ...edits, [m.id]: e.target.value })}
                  onBlur={() => saveBody(m)}
                />
                {busy === `save-${m.id}` && <span className="meta">Saving…</span>}
              </div>
            );
          })}
        </section>
      )}

      {skipped.length > 0 && (
        <details className="outreach-section">
          <summary>Left out ({skipped.length})</summary>
          {skipped.map((m) => (
            <div key={m.id} className="row" style={{ justifyContent: 'space-between', margin: '8px 0' }}>
              <span>
                {candidateLabel(m)} <span className="meta">· {m.matchReason}</span>
              </span>
              {!closed && (
                <button className="btn-secondary btn-small" onClick={() => toggleSkip(m)} disabled={!!busy}>Put back</button>
              )}
            </div>
          ))}
        </details>
      )}

      {interested.length > 0 && (
        <section className="outreach-section">
          <h2>Interested ({interested.length})</h2>
          {interested.map((m) => (
            <div key={m.id} className="card outreach-reply outreach-reply-yes">
              <div className="row" style={{ justifyContent: 'space-between', margin: 0, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{candidateLabel(m)}</strong>
                  <div className="meta">{candidateFacts(m)}</div>
                </div>
                <span className="meta">Replied {formatShortDate(m.respondedAt)}</span>
              </div>
              {m.candidateNote && <p className="outreach-note">“{m.candidateNote}”</p>}
              {m.contact && (
                <p style={{ margin: '4px 0' }}>
                  {m.contact.email && <a href={`mailto:${m.contact.email}`}>{m.contact.email}</a>}
                  {m.contact.email && m.contact.phone && ' · '}
                  {m.contact.phone && <a href={`tel:${m.contact.phone}`}>{m.contact.phone}</a>}
                </p>
              )}
              <div>
                <AtsDownloadButton candidateId={m.candidateId} name={m.candidate.name} />
              </div>
              {c.anonymised ? (
                <StaffingSubmitToClient
                  candidateId={m.candidateId}
                  defaultRole={c.job.title}
                  fixedClient={c.job.client ?? undefined}
                  projectRoleId={c.job.projectRoleId ?? undefined}
                />
              ) : (
                m.shortlistEntryId && (
                  <Link href="/employer/shortlist" className="meta">On this job’s shortlist — invite them to interview from there</Link>
                )
              )}
            </div>
          ))}
        </section>
      )}

      {others.length > 0 && (
        <section className="outreach-section">
          <h2>Sent</h2>
          <div className="admin-table-wrap">
            <table className="admin-table outreach-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Follow-ups</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {others.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {candidateLabel(m)}
                      <div className="meta">{m.matchReason}</div>
                    </td>
                    <td>
                      <Badge variant={MESSAGE_STATUS_VARIANT[m.status]}>{MESSAGE_STATUS_LABEL[m.status]}</Badge>
                    </td>
                    <td>{formatShortDate(m.sentAt)}</td>
                    <td>
                      {m.followUpsSent > 0 ? `${m.followUpsSent} sent` : 'None yet'}
                      {m.nextFollowUpAt && m.status === 'SENT' && c.status === 'ACTIVE' && (
                        <div className="meta">Next {formatShortDate(m.nextFollowUpAt)}</div>
                      )}
                    </td>
                    <td>{m.candidateNote ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {c.messages.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>
            No candidates who allow contact match this job yet. Try <strong>Find more candidates</strong> later, or loosen the
            required skill levels on the job.
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`status-card${strong ? ' outreach-tile-strong' : ''}`}>
      <div className="status-card-label">{label}</div>
      <div className="status-stat">{value}</div>
    </div>
  );
}
