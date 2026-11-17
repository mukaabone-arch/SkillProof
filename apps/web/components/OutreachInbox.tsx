'use client';

/**
 * The candidate's Opportunities inbox (GET /outreach/me): employers and
 * recruiters who found them through AI sourcing and wrote to them about a
 * role. One-tap replies; saying Interested is what shares their contact
 * details with that one company. Renders nothing when empty unless
 * `showEmpty` (the Opportunities page itself).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ErrorState } from '@/components/ui';
import { Opportunity, OutreachResponse, RESPONSE_LABEL, formatSalary, formatShortDate } from '@/lib/outreach';

interface Props {
  showEmpty?: boolean;
  /** Message to scroll to and highlight (from the email link). */
  focusId?: string | null;
}

export default function OutreachInbox({ showEmpty = false, focusId = null }: Props) {
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    api<Opportunity[]>('/outreach/me')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (focusId && items?.some((i) => i.id === focusId)) {
      document.getElementById(`opportunity-${focusId}`)?.scrollIntoView({ block: 'center' });
    }
  }, [focusId, items]);

  async function respond(o: Opportunity, response: OutreachResponse) {
    setBusy(o.id);
    setError('');
    try {
      const note = notes[o.id]?.trim() || undefined;
      const r = await api<{ status: Opportunity['status']; respondedAt: string; candidateNote: string | null }>(
        `/outreach/me/${o.id}/respond`,
        { method: 'POST', body: JSON.stringify({ response, note }) },
      );
      setItems((list) =>
        (list ?? []).map((x) =>
          x.id === o.id ? { ...x, status: r.status, respondedAt: r.respondedAt, candidateNote: r.candidateNote, canRespond: r.status === 'NOT_NOW' } : x,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!items) return null;
  if (items.length === 0 && !showEmpty) return null;

  const open = items.filter((o) => o.status === 'SENT');
  const earlier = items.filter((o) => o.status !== 'SENT');

  return (
    <section className="staffing-inbox outreach-inbox">
      <h2>Employers who reached out</h2>
      <p className="meta">
        Verified employers and recruiters whose roles match your verified skills. They see your contact details only if you
        say Interested. <Link href="/opportunities#contact-settings">Who can contact me</Link>
      </p>
      {error && <ErrorState message={error} />}
      {items.length === 0 && <p className="meta">No messages yet. When a role matches your verified skills, it will show up here.</p>}

      {[...open, ...earlier.filter((o) => o.canRespond)].map((o) => (
        <OpportunityCard
          key={o.id}
          o={o}
          focused={o.id === focusId}
          busy={busy === o.id}
          note={notes[o.id] ?? ''}
          onNote={(v) => setNotes({ ...notes, [o.id]: v })}
          onRespond={(r) => respond(o, r)}
        />
      ))}

      {earlier.filter((o) => !o.canRespond).length > 0 && (
        <details className="staffing-past">
          <summary>Earlier messages ({earlier.filter((o) => !o.canRespond).length})</summary>
          {earlier
            .filter((o) => !o.canRespond)
            .map((o) => (
              <div key={o.id} className="row" style={{ margin: '6px 0', justifyContent: 'space-between' }}>
                <span>
                  {o.job.title} · {o.orgName}
                </span>
                <span className="meta">{RESPONSE_LABEL[o.status]}</span>
              </div>
            ))}
        </details>
      )}
    </section>
  );
}

function OpportunityCard({
  o,
  focused,
  busy,
  note,
  onNote,
  onRespond,
}: {
  o: Opportunity;
  focused: boolean;
  busy: boolean;
  note: string;
  onNote: (v: string) => void;
  onRespond: (r: OutreachResponse) => void;
}) {
  const salary = formatSalary(o.job.salary);
  const where = [o.job.location, o.job.remote ? 'remote OK' : null].filter(Boolean).join(' · ');
  return (
    <div id={`opportunity-${o.id}`} className={`card staffing-request outreach-opportunity${focused ? ' is-focused' : ''}`}>
      <div className="row" style={{ margin: 0, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong>{o.job.title}</strong>
        <span className="meta">{formatShortDate(o.sentAt)}</span>
      </div>
      <div className="meta">
        From {o.orgName}
        {o.fromRecruiter ? ' (recruiter)' : ''}
      </div>
      <p className="outreach-body">{o.body}</p>
      <div className="staffing-facts">
        <span>{o.job.employmentType.replace(/_/g, ' ').toLowerCase()}</span>
        {where && <span>{where}</span>}
        {salary && <span>{salary}</span>}
      </div>

      {o.status === 'NOT_NOW' && <p className="meta" style={{ margin: '6px 0 0' }}>You said Not now. You can still change your mind.</p>}
      <div className="field" style={{ margin: '8px 0 0' }}>
        <label htmlFor={`note-${o.id}`} className="meta" style={{ fontWeight: 400 }}>
          Add a note (optional)
        </label>
        <input
          id={`note-${o.id}`}
          maxLength={500}
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="e.g. Available from January, prefer remote"
        />
      </div>
      <div className="row" style={{ margin: '8px 0 0', flexWrap: 'wrap' }}>
        <button onClick={() => onRespond('INTERESTED')} disabled={busy}>
          {busy ? 'Sending…' : 'Interested — share my contact details'}
        </button>
        {o.status !== 'NOT_NOW' && (
          <button className="btn-secondary" onClick={() => onRespond('NOT_NOW')} disabled={busy}>Not now</button>
        )}
        <button className="btn-secondary" onClick={() => onRespond('NOT_INTERESTED')} disabled={busy}>Not for me</button>
      </div>
    </div>
  );
}
