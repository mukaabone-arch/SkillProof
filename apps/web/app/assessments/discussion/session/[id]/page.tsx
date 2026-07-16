'use client';

/**
 * The live conversation. No CandidateNav (matches the MCQ take-flow's own
 * chrome-free convention) and deliberately no structural signal anywhere:
 * no progress bar, no claim/probe counter, no score — just the brief, the
 * transcript, and an input. See the header row below for the only two
 * things shown: elapsed time and "recorded, reviewed by a person."
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

interface SessionSummary {
  id: string;
  status: string;
  pinnedBrief: string;
  startedAt: string;
  expiresAt: string;
}
interface Turn {
  id: string;
  role: 'CANDIDATE' | 'ASSESSOR';
  content: string;
  superseded: boolean;
  createdAt: string;
}

const DECIDED_STATUSES = ['ISSUED', 'REJECTED', 'DISPUTED'];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function DiscussionSessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [briefExpanded, setBriefExpanded] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    try {
      let current = await api<{ session: SessionSummary; turns: Turn[] }>(`/assessment-sessions/${id}`);

      // Interrupted (idle timeout) — resume before rendering anything, so
      // the candidate only ever sees the re-asked probe as the live state,
      // never a dead-ended EXPIRED screen with nothing to do.
      if (current.session.status === 'EXPIRED') {
        await api(`/assessment-sessions/${id}/resume`, { method: 'POST' });
        current = await api<{ session: SessionSummary; turns: Turn[] }>(`/assessment-sessions/${id}`);
      }

      if (DECIDED_STATUSES.includes(current.session.status)) {
        router.replace(`/assessments/discussion/session/${id}/result`);
        return;
      }

      setSession(current.session);
      setTurns(current.turns);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  // Compact bar on phone widths, full brief on wider ones — expandable
  // either way by tapping.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setBriefExpanded(window.matchMedia('(min-width: 641px)').matches);
  }, []);

  useEffect(() => {
    if (!session) return;
    const startMs = new Date(session.startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, sending]);

  async function send() {
    const content = draft.trim();
    if (!content || sending || !session) return;
    setSending(true);
    setError('');
    setDraft('');
    try {
      const resp = await api<{ candidateTurn: Turn; assessorTurn: Turn; session: SessionSummary }>(
        `/assessment-sessions/${id}/turns`,
        { method: 'POST', body: JSON.stringify({ content }) },
      );
      if (DECIDED_STATUSES.includes(resp.session.status)) {
        router.replace(`/assessments/discussion/session/${id}/result`);
        return;
      }
      setTurns((prev) => [...prev, resp.candidateTurn, resp.assessorTurn]);
      setSession(resp.session);
    } catch (e) {
      setError((e as Error).message);
      setDraft(content); // restore what they typed so nothing is lost
      // The session may have expired between page load and this send (e.g.
      // idle too long mid-thought) — resync so the next attempt sees the
      // real state instead of repeating the same failure.
      await load();
    } finally {
      setSending(false);
    }
  }

  if (!loaded) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }
  if (error && !session) {
    return (
      <main>
        <p className="error">{error}</p>
        <Link href="/assessments">← Back to assessments</Link>
      </main>
    );
  }
  if (!session) return null;

  if (session.status === 'AWAITING_SCORING' || session.status === 'AWAITING_REVIEW') {
    return (
      <main className="discussion-end">
        <h1>Thanks for talking that through</h1>
        <p>
          Your session has been recorded. A person on our team reviews it before anything is decided — you&apos;ll
          hear back within a day.
        </p>
        <Link href="/assessments">← Back to assessments</Link>
      </main>
    );
  }

  return (
    <main className="discussion-session">
      <div
        className={`discussion-brief ${briefExpanded ? 'expanded' : 'collapsed'}`}
        onClick={() => setBriefExpanded((v) => !v)}
        role="button"
        tabIndex={0}
      >
        {briefExpanded ? (
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{session.pinnedBrief}</p>
        ) : (
          <p style={{ margin: 0 }}>📌 The brief — tap to expand</p>
        )}
      </div>

      <div className="discussion-header-row">
        <span className="meta">Elapsed {formatElapsed(elapsed)}</span>
        <span className="meta">Recorded · reviewed by a person</span>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="discussion-turns">
        {turns.map((t) => (
          <div
            key={t.id}
            className={`discussion-turn discussion-turn-${t.role.toLowerCase()}${t.superseded ? ' discussion-turn-superseded' : ''}`}
          >
            <div className="discussion-turn-content">{t.content}</div>
            {t.superseded && <div className="meta">re-asked after a connection drop</div>}
          </div>
        ))}
        {sending && (
          <div className="discussion-turn discussion-turn-assessor discussion-typing">
            <span className="spinner" aria-hidden="true" />
            <span className="meta">thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="discussion-input-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending}
          placeholder="Type your response…"
        />
        <button onClick={send} disabled={sending || !draft.trim()}>
          Send
        </button>
      </div>
    </main>
  );
}
