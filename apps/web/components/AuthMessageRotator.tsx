'use client';

import { useEffect, useState } from 'react';

export interface AuthMessage {
  headline: string;
  support: string;
}

/** Candidate login's messages (OtpLogin.tsx) — the default so that caller doesn't need to pass its own. */
const CANDIDATE_MESSAGES: AuthMessage[] = [
  {
    headline: 'Apply in minutes, not hours',
    support: 'Your verified profile does the work — no re-typing the same details into every application.',
  },
  {
    headline: 'A co-pilot that knows your next move',
    support: 'See exactly which skill is holding you back, and which roles open up once you prove it.',
  },
  {
    headline: 'Talk directly to companies hiring for AI skills',
    support: 'No black-hole applications. Track every interview, round and offer in one place.',
  },
  {
    headline: 'Proof, not promises',
    support: 'Skills verified through real conversation and reviewed by a person — evidence employers can check.',
  },
];

const ROTATE_MS = 7000;

interface Props {
  /** Defaults to the candidate set — EmployerOtpLogin.tsx passes its own employer-facing messages. */
  messages?: AuthMessage[];
}

/**
 * Rotating value-prop messaging for a split-layout login page's decorative
 * gradient panel — used by both OtpLogin.tsx (candidate, default messages)
 * and EmployerOtpLogin.tsx (employer, own `messages` prop). Message content
 * is the only thing that differs between the two; the rotation mechanics
 * (interval, crossfade, pause, reduced-motion, dots) are shared so both
 * portals stay in step rather than one drifting from the other via a fork.
 *
 * Deliberately restrained: a slow opacity crossfade every ROTATE_MS, never
 * continuous motion — something shifting in peripheral vision while someone
 * types into the form beside it would be distracting and an accessibility
 * problem. Pauses on hover/focus, and under prefers-reduced-motion the
 * rotation never starts at all (index stays 0 forever) rather than just
 * skipping the transition — a single static message, not a frozen carousel.
 */
export default function AuthMessageRotator({ messages = CANDIDATE_MESSAGES }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reducedMotion || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % messages.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [reducedMotion, paused, messages]);

  const activeIndex = reducedMotion ? 0 : index;

  return (
    <div
      className="auth-split-message-rotator"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="auth-split-message-scrim" aria-hidden="true" />
      <div className="auth-split-message-stack">
        {messages.map((m, i) => (
          <div
            key={m.headline}
            className={i === activeIndex ? 'auth-split-message is-active' : 'auth-split-message'}
            aria-hidden={i !== activeIndex}
          >
            <p className="auth-split-message-headline">{m.headline}</p>
            <p className="auth-split-message-support">{m.support}</p>
          </div>
        ))}
      </div>
      {!reducedMotion && (
        <div className="auth-split-message-dots" aria-hidden="true">
          {messages.map((m, i) => (
            <span key={m.headline} className={i === activeIndex ? 'is-active' : ''} />
          ))}
        </div>
      )}
    </div>
  );
}
