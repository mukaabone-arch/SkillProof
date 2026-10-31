'use client';

/**
 * Mock interview — the live practice conversation (POST/GET
 * /interview-sessions). Coaching only: nothing here touches badges or
 * matching, and employers never see it (see InterviewSessionsService's own
 * doc comment). Questions come from the admin-curated bank; the coach's
 * connective lines are fixed templates, so the only AI-written text is the
 * end-of-session feedback on the result page.
 *
 * One session at a time per candidate (createSession returns the active one
 * if it exists), resumable after the idle timeout via POST :id/resume.
 */
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { ErrorState, LoadingState } from '@/components/ui';

interface Session {
  id: string;
  status: 'IN_PROGRESS' | 'EXPIRED' | 'AWAITING_FEEDBACK' | 'COMPLETED';
  progress: unknown;
}
interface Turn {
  id: string;
  role: string;
  content: string;
  superseded: boolean;
}

function progressOf(p: unknown): { current: number; total: number } | null {
  if (p && typeof p === 'object') {
    const { current, total } = p as { current?: unknown; total?: unknown };
    if (typeof current === 'number' && typeof total === 'number' && total > 0) return { current, total };
  }
  return null;
}

export default function PracticeInterviewPage() {
  const ready = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [waitedSeconds, setWaitedSeconds] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    api<{ session: Session; turns: Turn[] }>(`/interview-sessions/${id}`)
      .then((r) => {
        setSession(r.session);
        setTurns(r.turns);
      })
      .catch((e) => setError((e as Error).message));
  }, [ready, id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  // Once the conversation is over, poll for the feedback and move on.
  const finished = session?.status === 'AWAITING_FEEDBACK' || session?.status === 'COMPLETED';
  useEffect(() => {
    if (!finished) return;
    let stopped = false;
    const tick = async () => {
      try {
        await api(`/interview-sessions/${id}/result`);
        if (!stopped) router.replace(`/interviews/practice/${id}/result`);
      } catch {
        if (!stopped) setWaitedSeconds((s) => s + 4);
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [finished, id, router]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError('');
    try {
      const r = await api<{ candidateTurn: Turn; coachTurn: Turn; session: Session }>(`/interview-sessions/${id}/turns`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      setTurns((t) => [...t, r.candidateTurn, r.coachTurn]);
      setSession(r.session);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function resume() {
    setSending(true);
    setError('');
    try {
      const r = await api<{ turn: Turn; session: Session }>(`/interview-sessions/${id}/resume`, { method: 'POST' });
      void r;
      // The server marks the unanswered fragment superseded — refetch so the history shows that.
      const fresh = await api<{ session: Session; turns: Turn[] }>(`/interview-sessions/${id}`);
      setTurns(fresh.turns);
      setSession(fresh.session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function retryFeedback() {
    try {
      await api(`/interview-sessions/${id}/feedback/retry`, { method: 'POST' });
      setWaitedSeconds(0);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
  }

  if (!ready) return null;
  const progress = progressOf(session?.progress);

  return (
    <main className="container-standard mock-page">
      <div className="mock-top">
        <Link href="/interviews">← Interviews</Link>
        <span className="meta">Practice interview · never shown to employers</span>
        {progress && (
          <span className="mock-progress" aria-label={`Question ${progress.current} of ${progress.total}`}>
            <span style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }} />
          </span>
        )}
      </div>

      {error && <ErrorState message={error} />}
      {!session && !error && <LoadingState />}

      <div className="mock-thread">
        {turns.map((t) =>
          t.role === 'CANDIDATE' ? (
            <div key={t.id} className={`mock-turn mock-turn-you${t.superseded ? ' mock-superseded' : ''}`}>
              <div className="mock-label">You</div>
              <p>{t.content}</p>
            </div>
          ) : (
            <div key={t.id} className={`mock-turn mock-turn-coach${t.superseded ? ' mock-superseded' : ''}`}>
              <div className="mock-label"><span className="mock-mark" aria-hidden="true">P</span>Practice interviewer</div>
              {t.content.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      {session?.status === 'IN_PROGRESS' && (
        <form className="mock-compose" onSubmit={send}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={5}
            placeholder="Answer as you would out loud — a specific situation, what you did, and the result."
            disabled={sending}
          />
          <div className="row" style={{ margin: 0, justifyContent: 'space-between' }}>
            <span className="meta">Ctrl/⌘ + Enter to send</span>
            <button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send answer'}</button>
          </div>
        </form>
      )}

      {session?.status === 'EXPIRED' && (
        <div className="card mock-note">
          <p style={{ margin: 0 }}>This session paused after a while without activity. Pick up where you left off — the last question will be asked again.</p>
          <button onClick={resume} disabled={sending}>{sending ? 'Resuming…' : 'Resume practice'}</button>
        </div>
      )}

      {finished && (
        <div className="card mock-note">
          <p style={{ margin: 0 }}>Putting together feedback on each of your answers…</p>
          {waitedSeconds >= 60 && (
            <button className="btn-secondary" onClick={retryFeedback}>Taking a while? Try again</button>
          )}
        </div>
      )}
    </main>
  );
}
