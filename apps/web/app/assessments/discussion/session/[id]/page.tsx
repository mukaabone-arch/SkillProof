'use client';

/**
 * The live conversation. No CandidateNav (matches the MCQ take-flow's own
 * chrome-free convention). Structured as a topbar (progress/counter/timer)
 * plus a stream of per-topic question cards — each wraps one claim's whole
 * exchange (opening/followup/constraint) — followed, once that topic is
 * done, by a gradient-hairline reviewer card carrying LiveClaimFeedback:
 * informal, live coaching notes, deliberately separate from the official
 * scored result (hidden until a human reviewer decides the session — see
 * the result page). The AI interviewer's own turns never reveal claim
 * names or rubric structure in conversation (see assessor.service.ts's
 * leak guard); claimId itself is now exposed on turns/feedback purely as
 * an opaque grouping key for this UI, not as rubric content.
 */
import { ClipboardEvent, Fragment, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

interface SessionSummary {
  id: string;
  status: string;
  pinnedBrief: string;
  startedAt: string;
  expiresAt: string;
  // Server-computed snapshot (wall clock since startedAt, minus logged
  // interruption gaps — see AssessmentSessionsService.computeElapsedSeconds)
  // and the real idle-timeout config value, not a hardcoded guess. Every
  // session-touching endpoint returns a fresh one of these.
  elapsedSeconds: number;
  idleTimeoutMinutes: number;
  // Advertised (not enforced) session length — DISCUSSION_DURATION_MINS,
  // the same single source of truth used in the pre-session copy. Drives
  // only the cosmetic topbar countdown; the real timeout stays idle-based.
  advertisedDurationMinutes: number;
  // Claim count only — never which claim. See computeProgress.
  progress: { current: number; total: number };
}
interface Turn {
  id: string;
  role: 'CANDIDATE' | 'ASSESSOR';
  content: string;
  // Opaque grouping key for this UI (which topic card a turn belongs to) —
  // never a rubric label. See PublicTurn's own doc comment.
  claimId: string | null;
  superseded: boolean;
  createdAt: string;
}
type VerdictTone = 'positive' | 'mixed' | 'needs_work';
interface LiveFeedback {
  id: string;
  claimId: string;
  verdictLabel: string;
  verdictTone: VerdictTone;
  summary: string;
  strengths: string[];
  gaps: string[];
  helpfulVote: boolean | null;
}

/** Chip color/icon come from the model's own verdictTone, never guessed from verdictLabel text — see LiveFeedbackService. */
const TONE_META: Record<VerdictTone, { icon: string; className: string }> = {
  positive: { icon: '✓', className: 'tone-positive' },
  mixed: { icon: '~', className: 'tone-mixed' },
  needs_work: { icon: '✕', className: 'tone-needs_work' },
};

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

/**
 * Composition telemetry for the answer currently being written, sent
 * alongside its content on submit (see send()) — never surfaced anywhere in
 * this UI. Reviewer-facing context only, computed and rendered on the admin
 * case page from what the server persists; nothing here changes what the
 * candidate sees or how the input behaves. Reset whenever a new assessor
 * turn renders (see the reset effect below), since each is scoped to one
 * candidate answer.
 */
interface TurnSignalsAccumulator {
  pasteCount: number;
  pastedCharCount: number;
  largestPasteChars: number;
  blurCount: number;
  blurDurationMs: number;
  assessorTurnRenderedAt: number | null;
  firstKeystrokeAt: number | null;
}

function freshSignals(): TurnSignalsAccumulator {
  return {
    pasteCount: 0,
    pastedCharCount: 0,
    largestPasteChars: 0,
    blurCount: 0,
    blurDurationMs: 0,
    assessorTurnRenderedAt: Date.now(),
    firstKeystrokeAt: null,
  };
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

/** mm:ss under an hour, h:mm at or beyond it — never raw minutes. */
function formatElapsed(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const totalMinutes = Math.floor(clamped / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}:${String(clamped % 60).padStart(2, '0')}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

/**
 * Maps each claimId to the index of its last turn — used to render the
 * matching reviewer card immediately after a claim's final turn in the
 * flat thread, without needing to wrap each claim's turns in their own
 * container. A claim's turns are always contiguous (the ladder walks
 * CLAIM_ORDER once, forward only), so "last occurrence" is unambiguous.
 */
function lastIndexByClaim(turns: Turn[]): Map<string, number> {
  const map = new Map<string, number>();
  turns.forEach((t, i) => {
    if (t.claimId) map.set(t.claimId, i);
  });
  return map;
}

/** ~3 rows to start; grows with content up to a max height, then scrolls internally. */
const TEXTAREA_MAX_HEIGHT_PX = 240;

export default function DiscussionSessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [claimFeedback, setClaimFeedback] = useState<LiveFeedback[]>([]);
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [briefExpanded, setBriefExpanded] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const signalsRef = useRef<TurnSignalsAccumulator>(freshSignals());
  const draftRef = useRef('');
  const blurStartedAtRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    try {
      let current = await api<{ session: SessionSummary; turns: Turn[]; claimFeedback: LiveFeedback[] }>(`/assessment-sessions/${id}`);

      // Interrupted (idle timeout) — resume before rendering anything, so
      // the candidate only ever sees the re-asked probe as the live state,
      // never a dead-ended EXPIRED screen with nothing to do.
      if (current.session.status === 'EXPIRED') {
        await api(`/assessment-sessions/${id}/resume`, { method: 'POST' });
        current = await api<{ session: SessionSummary; turns: Turn[]; claimFeedback: LiveFeedback[] }>(`/assessment-sessions/${id}`);
      }

      if (DECIDED_STATUSES.includes(current.session.status)) {
        router.replace(`/assessments/discussion/session/${id}/result`);
        return;
      }

      setSession(current.session);
      setTurns(current.turns);
      setClaimFeedback(current.claimFeedback);
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

  // Anchored to the server's elapsedSeconds snapshot (active time only —
  // wall clock since startedAt minus logged interruption gaps) plus local
  // wall-clock time elapsed since that snapshot arrived, re-anchoring on
  // every fresh session response (load, resume, each turn). NOT computed
  // from startedAt directly — that's what produced the old "641:28" bug for
  // any session that had ever been interrupted and resumed.
  useEffect(() => {
    if (!session) return;
    const baseSeconds = session.elapsedSeconds;
    const asOf = Date.now();
    const tick = () => setElapsed(baseSeconds + Math.floor((Date.now() - asOf) / 1000));
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

  // A fresh answer starts whenever the latest turn is the assessor's (the
  // opening turn on first load, or a new question after each send) — reset
  // this turn's composition signals and mark when the question rendered, so
  // timeToFirstKeystrokeMs measures from here.
  useEffect(() => {
    if (turns.length === 0) return;
    if (turns[turns.length - 1].role === 'ASSESSOR') {
      signalsRef.current = freshSignals();
    }
  }, [turns]);

  // Window blur/focus while composing — only counted if the textarea
  // currently has focus or already has content, so casually tabbing away
  // before starting an answer doesn't register as anything.
  useEffect(() => {
    function onWindowBlur() {
      const isComposing = document.activeElement === textareaRef.current || draftRef.current.trim().length > 0;
      if (isComposing && blurStartedAtRef.current === null) {
        blurStartedAtRef.current = Date.now();
        signalsRef.current.blurCount += 1;
      }
    }
    function onWindowFocus() {
      if (blurStartedAtRef.current !== null) {
        signalsRef.current.blurDurationMs += Date.now() - blurStartedAtRef.current;
        blurStartedAtRef.current = null;
      }
    }
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, []);

  function onDraftChange(value: string) {
    setDraft(value);
    draftRef.current = value;
    if (signalsRef.current.firstKeystrokeAt === null && value.length > 0) {
      signalsRef.current.firstKeystrokeAt = Date.now();
    }
  }

  // Observe only — never blocks or strips a paste.
  function onTextareaPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const s = signalsRef.current;
    s.pasteCount += 1;
    s.pastedCharCount += text.length;
    s.largestPasteChars = Math.max(s.largestPasteChars, text.length);
  }

  async function send() {
    const content = draft.trim();
    if (!content || sending || !session) return;
    setSending(true);
    setError('');
    setDraft('');
    draftRef.current = '';

    const s = signalsRef.current;
    const sentAt = Date.now();
    const timeToFirstKeystrokeMs =
      s.assessorTurnRenderedAt != null && s.firstKeystrokeAt != null ? s.firstKeystrokeAt - s.assessorTurnRenderedAt : undefined;
    const compositionDurationMs = s.firstKeystrokeAt != null ? sentAt - s.firstKeystrokeAt : undefined;
    const charCount = content.length;
    const effectiveWpm =
      compositionDurationMs && compositionDurationMs > 0 ? charCount / 5 / (compositionDurationMs / 60_000) : undefined;
    const signals = {
      pasteCount: s.pasteCount,
      pastedCharCount: s.pastedCharCount,
      largestPasteChars: s.largestPasteChars,
      timeToFirstKeystrokeMs,
      compositionDurationMs,
      charCount,
      effectiveWpm,
      blurCount: s.blurCount,
      blurDurationMs: s.blurDurationMs,
    };

    try {
      const resp = await api<{ candidateTurn: Turn; assessorTurn: Turn; session: SessionSummary; liveFeedback: LiveFeedback | null }>(
        `/assessment-sessions/${id}/turns`,
        { method: 'POST', body: JSON.stringify({ content, signals }) },
      );
      if (DECIDED_STATUSES.includes(resp.session.status)) {
        router.replace(`/assessments/discussion/session/${id}/result`);
        return;
      }
      setTurns((prev) => [...prev, resp.candidateTurn, resp.assessorTurn]);
      setSession(resp.session);
      if (resp.liveFeedback) {
        const fb = resp.liveFeedback;
        setClaimFeedback((prev) => {
          const idx = prev.findIndex((f) => f.claimId === fb.claimId);
          if (idx === -1) return [...prev, fb];
          const next = [...prev];
          next[idx] = fb;
          return next;
        });
      }
    } catch (e) {
      setError((e as Error).message);
      setDraft(content); // restore what they typed so nothing is lost
      draftRef.current = content; // keep the blur-tracking check in sync with the restored draft
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
    // nothing). Cmd/Ctrl+Enter sends; the Submit button is the only other way.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  /**
   * Pure navigation — never touches session state. The session stays
   * exactly as it is (IN_PROGRESS or EXPIRED); resume-not-restart and the
   * existing idle-expiry window handle everything else. idleTimeoutMinutes
   * comes from the server (the real config value, not a guess) so this
   * copy can't drift out of sync with what actually happens.
   */
  function onExit() {
    if (!session) return;
    const confirmed = window.confirm(
      `Leaving won't end your session — it stays open, and you can pick it back up from the Assessments page. ` +
        `If you're away for more than ${session.idleTimeoutMinutes} minutes, it'll time out, but resuming just continues right where you left off.`,
    );
    if (confirmed) {
      router.push('/assessments');
    }
  }

  /** Default-open only the most recently generated note; earlier ones start collapsed until toggled. */
  function isFeedbackOpen(claimId: string): boolean {
    if (claimId in openOverrides) return openOverrides[claimId];
    return claimFeedback.length > 0 && claimFeedback[claimFeedback.length - 1].claimId === claimId;
  }

  function toggleFeedback(claimId: string) {
    setOpenOverrides((prev) => ({ ...prev, [claimId]: !isFeedbackOpen(claimId) }));
  }

  /** Optimistic — a failed vote just leaves the UI toggled; not worth surfacing an error for a low-stakes signal. */
  async function voteFeedback(claimId: string, helpful: boolean) {
    setClaimFeedback((prev) => prev.map((f) => (f.claimId === claimId ? { ...f, helpfulVote: helpful } : f)));
    try {
      await api(`/assessment-sessions/${id}/claims/${claimId}/feedback-vote`, {
        method: 'POST',
        body: JSON.stringify({ helpful }),
      });
    } catch {
      // best-effort, see doc comment above
    }
  }

  function renderTurn(t: Turn, index: number) {
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
  }

  function renderInputArea() {
    return (
      <div className="discussion-input-row">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          onPaste={onTextareaPaste}
          disabled={sending}
          placeholder="Type your response…"
          rows={3}
        />
        <div className="discussion-send-col">
          <button onClick={send} disabled={sending || !draft.trim()}>
            {sending ? 'Submitting…' : 'Submit answer'}
          </button>
          <span className="discussion-input-hint">⌘/Ctrl + Enter to submit</span>
        </div>
      </div>
    );
  }

  function renderReviewerCard(fb: LiveFeedback) {
    const open = isFeedbackOpen(fb.claimId);
    const tone = TONE_META[fb.verdictTone];
    return (
      <section className={`discussion-reviewer${open ? '' : ' closed'}`} key={`fb-${fb.claimId}`} aria-label="Reviewer notes">
        <div className="discussion-reviewer-inner">
          <div className="discussion-reviewer-head">
            <span className="discussion-assessor-mark" aria-hidden="true">✦</span>
            <h3>Reviewer notes</h3>
            <button
              type="button"
              className="discussion-chev"
              onClick={() => toggleFeedback(fb.claimId)}
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} reviewer notes`}
            >
              <ChevronIcon />
            </button>
          </div>
          <div className="discussion-reviewer-body">
            <span className={`discussion-verdict ${tone.className}`}>
              {tone.icon} {fb.verdictLabel} · {fb.summary}
            </span>
            <ul className="discussion-points">
              {fb.strengths.map((s, i) => (
                <li key={`s-${i}`}>{s}</li>
              ))}
              {fb.gaps.map((g, i) => (
                <li key={`g-${i}`} className="gap">
                  <em>Gap:</em> {g}
                </li>
              ))}
            </ul>
            <div className="discussion-feedback-foot">
              <span className="discussion-feedback-ask">Was this explanation helpful?</span>
              <div className="discussion-pills">
                <button
                  type="button"
                  className="discussion-pill"
                  aria-pressed={fb.helpfulVote === true}
                  onClick={() => voteFeedback(fb.claimId, true)}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="discussion-pill no"
                  aria-pressed={fb.helpfulVote === false}
                  onClick={() => voteFeedback(fb.claimId, false)}
                >
                  Not really
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
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

  const lastIdx = lastIndexByClaim(turns);
  const remainingCosmetic = Math.max(0, session.advertisedDurationMinutes * 60 - elapsed);
  const timerWarn = remainingCosmetic < 120;
  const progressPct = Math.round((session.progress.current / session.progress.total) * 100);

  return (
    <main className="discussion-session">
      <div
        className="discussion-progress"
        role="progressbar"
        aria-valuenow={session.progress.current}
        aria-valuemin={1}
        aria-valuemax={session.progress.total}
        aria-label={`Question ${session.progress.current} of ${session.progress.total}`}
      >
        <i style={{ width: `${progressPct}%` }} />
      </div>

      <div className="discussion-topbar">
        <div className="discussion-topbar-left">
          <span className="discussion-counter">
            Q {session.progress.current}/{session.progress.total}
          </span>
          <span className={`discussion-timer${timerWarn ? ' warn' : ''}`} aria-live="off">
            {formatElapsed(remainingCosmetic)}
          </span>
        </div>
        <div className="discussion-topbar-right">
          <span className="meta">Recorded · reviewed by a person</span>
          <button type="button" className="discussion-exit-link" onClick={onExit}>
            Exit
          </button>
        </div>
      </div>

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

      {error && <p className="error">{error}</p>}

      <div className="discussion-turns">
        {/* Bottom-anchors a short thread without the scrollHeight bug justify-content:flex-end has here — see the CSS comment. */}
        <div className="discussion-turns-spacer" aria-hidden="true" />
        {turns.map((t, i) => {
          const fb = t.claimId && lastIdx.get(t.claimId) === i ? claimFeedback.find((f) => f.claimId === t.claimId) : undefined;
          return (
            <Fragment key={t.id}>
              {renderTurn(t, i)}
              {fb && renderReviewerCard(fb)}
            </Fragment>
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

      {renderInputArea()}
    </main>
  );
}
