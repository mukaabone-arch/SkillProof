'use client';

/**
 * The live conversation. No CandidateNav (matches the MCQ take-flow's own
 * chrome-free convention) and deliberately no structural signal anywhere:
 * no progress bar, no claim/probe counter, no score — just the brief, the
 * transcript, and an input. See the header row below for the only two
 * things shown: elapsed time and "recorded, reviewed by a person."
 */
import { Fragment, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Presentation-only identity for the assessor's turns — never sent to or
 * known by the model itself (the LLM's own behavior/system prompt is
 * unchanged). A name plus a small non-photographic mark so the transcript
 * reads as a dialogue between two parties, not an unmarked stream of grey
 * text against a grey page.
 */
const ASSESSOR_NAME = 'Sam';

function AssessorLabel() {
  return (
    <div className="discussion-turn-label">
      <span className="discussion-assessor-mark" aria-hidden="true">S</span>
      <span>{ASSESSOR_NAME} · Interviewer</span>
    </div>
  );
}

/**
 * The very first ASSESSOR turn ever persisted for a session joins its fixed
 * welcome/framing and the LLM-phrased first question with exactly one blank
 * line (see AssessorService.generateOpeningTurn) — split on that same
 * boundary so the framing renders once as a quiet system note and the
 * question renders as the assessor's actual first chat turn. Only turns[0]
 * is ever treated this way; a resumed re-ask is a plain later turn with no
 * framing to split out.
 */
function splitOpeningTurn(content: string): { framing: string; question: string } {
  const idx = content.indexOf('\n\n');
  if (idx === -1) return { framing: '', question: content };
  return { framing: content.slice(0, idx), question: content.slice(idx + 2) };
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** ~3 rows to start; grows with content up to a max height, then scrolls internally. */
const TEXTAREA_MAX_HEIGHT_PX = 240;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Autosize the textarea: reset to auto so scrollHeight reflects only the
  // content, then grow to fit it, capped at TEXTAREA_MAX_HEIGHT_PX (CSS
  // overflow-y:auto on the element takes over beyond that).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, [draft]);

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

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Plain Enter inserts a newline (default textarea behavior — do
    // nothing). Cmd/Ctrl+Enter sends; the Send button is the only other way.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
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
        {turns.map((t, index) => {
          if (index === 0 && t.role === 'ASSESSOR') {
            const { framing, question } = splitOpeningTurn(t.content);
            return (
              <Fragment key={t.id}>
                {framing && <div className="discussion-system-note">{framing}</div>}
                <div className={`discussion-turn discussion-turn-assessor${t.superseded ? ' discussion-turn-superseded' : ''}`}>
                  <AssessorLabel />
                  <div className="discussion-turn-content">{question}</div>
                  {t.superseded && <div className="meta">re-asked after a connection drop</div>}
                </div>
              </Fragment>
            );
          }
          return (
            <div
              key={t.id}
              className={`discussion-turn discussion-turn-${t.role.toLowerCase()}${t.superseded ? ' discussion-turn-superseded' : ''}`}
            >
              {t.role === 'ASSESSOR' && <AssessorLabel />}
              <div className="discussion-turn-content">{t.content}</div>
              {t.superseded && <div className="meta">re-asked after a connection drop</div>}
            </div>
          );
        })}
        {sending && (
          <div className="discussion-turn discussion-turn-assessor discussion-typing">
            <AssessorLabel />
            <div className="discussion-typing-dots">
              <span className="spinner" aria-hidden="true" />
              <span className="meta" style={{ margin: 0 }}>thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="discussion-input-row">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          disabled={sending}
          placeholder="Type your response…"
          rows={3}
        />
        <div className="discussion-send-col">
          <button onClick={send} disabled={sending || !draft.trim()}>
            Send
          </button>
          <span className="discussion-input-hint">⌘/Ctrl + Enter to send</span>
        </div>
      </div>
    </main>
  );
}
