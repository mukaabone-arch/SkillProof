'use client';

/**
 * "Ask MyAmbii" — the signed-in help assistant, opened from the Help item in
 * the candidate nav and the employer/recruiter sidebar (it replaced those
 * links to the static guides, which stay public at /help/* and are linked
 * from every answer). Answers come from POST /help/ask, which picks the
 * guide for the user's own role on the server.
 *
 * The conversation lives in sessionStorage, so it survives moving between
 * pages in the same tab and is gone when the tab closes. The first open
 * shows a short notice that questions go to our AI provider; agreeing is
 * remembered per browser.
 */
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, employerApi } from '@/lib/api';
import ReportAiContent from '@/components/ReportAiContent';

export type HelpAudience = 'candidate' | 'employer' | 'recruiter';

interface Source {
  id: string;
  label: string;
}

interface AskResult {
  id: string;
  answer: string;
  covered: boolean;
  sources: Source[];
  guidePath: string;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Assistant turns only. */
  result?: AskResult;
}

const MAX_CHARS = 1000;
/** Previous turns sent with a new question — an even number, so the slice always starts with a question. */
const HISTORY_TURNS = 18;
const CONSENT_KEY = 'myambii-help-ai-ok';
const storeKey = (audience: HelpAudience) => `myambii-help-chat-${audience}`;

const GUIDE_PATHS: Record<HelpAudience, string> = {
  candidate: '/help/candidate',
  employer: '/help/employer',
  recruiter: '/help/recruiter',
};

export const STARTERS: Record<HelpAudience, string[]> = {
  candidate: [
    'How do I get my first verified badge?',
    'How does the live discussion work?',
    'What do I need before I can apply for jobs?',
    'Can I retake an assessment?',
  ],
  employer: [
    'How do we get our organisation verified?',
    'How is the match score worked out?',
    'How do I ask a candidate to verify a skill?',
    'How do I add a colleague?',
  ],
  recruiter: [
    'How do I check if a candidate is available?',
    'How do I submit a candidate to a client?',
    'How long does representation last?',
    'Why was my submission blocked?',
  ],
};

function readJson<T>(storage: 'local' | 'session', key: string, fallback: T): T {
  try {
    const raw = (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage: 'local' | 'session', key: string, value: unknown) {
  try {
    (storage === 'local' ? window.localStorage : window.sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: the chat still works, it just won't be kept.
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  audience: HelpAudience;
  /** Which signed-in session to ask with. */
  client: 'candidate' | 'employer';
  /**
   * Render into <body> (candidate pages, where an ancestor transform would
   * trap a fixed panel). Leave false inside the employer shell so the panel
   * picks up that shell's light theme tokens.
   */
  portal?: boolean;
}

export default function HelpAssistant({ open, onClose, audience, client, portal = false }: Props) {
  const [mounted, setMounted] = useState(false);
  const [consented, setConsented] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setConsented(readJson('local', CONSENT_KEY, false));
    setTurns(readJson<Turn[]>('session', storeKey(audience), []));
  }, [audience]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && consented) inputRef.current?.focus();
  }, [open, consented]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  function save(next: Turn[]) {
    setTurns(next);
    writeJson('session', storeKey(audience), next);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || sending) return;
    if (q.length > MAX_CHARS) {
      setError(`Please keep your question under ${MAX_CHARS} characters.`);
      return;
    }
    const withQuestion: Turn[] = [...turns, { role: 'user', content: q }];
    save(withQuestion);
    setInput('');
    setError('');
    setSending(true);
    try {
      const send = client === 'employer' ? employerApi.api : api;
      const messages = withQuestion.slice(-(HISTORY_TURNS + 1)).map(({ role, content }) => ({ role, content }));
      const result = await send<AskResult>('/help/ask', {
        method: 'POST',
        body: JSON.stringify({ messages, platform: 'web' }),
      });
      save([...withQuestion, { role: 'assistant', content: result.answer, result }]);
    } catch (err) {
      // Take the unanswered question back out so the conversation still alternates.
      save(turns);
      setInput(q);
      setError((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(input);
    }
  }

  function startOver() {
    save([]);
    setError('');
    inputRef.current?.focus();
  }

  if (!mounted || !open) return null;

  const guidePath = GUIDE_PATHS[audience];
  const panel = (
    <div className="help-ai-root">
      <div className="help-ai-scrim" onClick={onClose} aria-hidden="true" />
      <section className="help-ai-panel" role="dialog" aria-modal="true" aria-labelledby="help-ai-title">
        <header className="help-ai-header">
          <div>
            <h2 id="help-ai-title">Ask MyAmbii</h2>
            <p>Answers from the MyAmbii {audience} guide</p>
          </div>
          <div className="help-ai-header-actions">
            {turns.length > 0 && (
              <button type="button" className="help-ai-text-btn" onClick={startOver}>
                New chat
              </button>
            )}
            <button type="button" className="help-ai-close" onClick={onClose} aria-label="Close help">
              ×
            </button>
          </div>
        </header>

        {!consented ? (
          <div className="help-ai-consent">
            <h3>Before you start</h3>
            <p>
              Your questions are sent to our AI provider, Anthropic, to write an answer from the MyAmbii guides. Please
              don&rsquo;t include personal details such as phone numbers, passwords or one-time codes.
            </p>
            <p>
              Answers are AI-generated and can be wrong. Each one links to the guide section it came from, and you can
              report an answer that looks wrong or harmful.
            </p>
            <button
              type="button"
              className="help-ai-primary"
              onClick={() => {
                writeJson('local', CONSENT_KEY, true);
                setConsented(true);
              }}
            >
              Agree and continue
            </button>
            <a className="help-ai-guide-link" href={guidePath} target="myambii-help" rel="noopener">
              Read the full guide instead
            </a>
          </div>
        ) : (
          <>
            <div className="help-ai-messages" ref={listRef} aria-live="polite">
              {turns.length === 0 && (
                <div className="help-ai-welcome">
                  <p>Hi! Ask anything about using MyAmbii, or start with one of these:</p>
                  <div className="help-ai-starters">
                    {STARTERS[audience].map((s) => (
                      <button key={s} type="button" className="help-ai-chip" onClick={() => void ask(s)} disabled={sending}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((t, i) =>
                t.role === 'user' ? (
                  <div key={i} className="help-ai-msg help-ai-msg-user">
                    {t.content}
                  </div>
                ) : (
                  <div key={i} className="help-ai-msg help-ai-msg-bot">
                    <div className="help-ai-answer">{t.content}</div>
                    {t.result && t.result.sources.length > 0 && (
                      <div className="help-ai-sources">
                        <span>From the guide:</span>
                        {t.result.sources.map((s) => (
                          <a key={s.id} href={`${t.result!.guidePath}#${s.id}`} target="myambii-help" rel="noopener">
                            {s.label}
                          </a>
                        ))}
                      </div>
                    )}
                    {t.result && (
                      <ReportAiContent
                        sessionId={t.result.id}
                        targetType="HELP_ANSWER"
                        targetId={t.result.id}
                        client={client}
                      />
                    )}
                  </div>
                ),
              )}
              {sending && (
                <div className="help-ai-msg help-ai-msg-bot help-ai-typing" role="status">
                  <span />
                  <span />
                  <span />
                  <span className="sr-only">Writing an answer…</span>
                </div>
              )}
            </div>

            <form className="help-ai-compose" onSubmit={onSubmit}>
              {error && (
                <p className="help-ai-error" role="alert">
                  {error}
                </p>
              )}
              <div className="help-ai-input-row">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  maxLength={MAX_CHARS}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask a question…"
                  aria-label="Your question"
                />
                <button type="submit" className="help-ai-send" disabled={sending || !input.trim()} aria-label="Send">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14" />
                    <path d="M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
              <p className="help-ai-footnote">
                AI answers can be wrong.{' '}
                <a href={guidePath} target="myambii-help" rel="noopener">
                  Open the full guide
                </a>
              </p>
            </form>
          </>
        )}
      </section>
    </div>
  );

  return portal ? createPortal(panel, document.body) : panel;
}
