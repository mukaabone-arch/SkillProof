'use client';

/**
 * The one place a 402 { code: 'LIMIT_REACHED' } response ever becomes UI —
 * subscribes to limitReachedBus (populated by lib/api.ts on every such
 * response, from any call site) and renders an upgrade prompt naming the
 * specific limit and its reset date. Never a generic error toast.
 *
 * Deliberately does NOT react to the two retake-specific metrics
 * (retakeCooldownDays / retakesPerSkillLifetime) — those get a tailored,
 * inline message right on the assessment screen where the attempt was
 * blocked (cooldown-until-date vs. lifetime-cap read very differently and
 * only one is solvable by upgrading), so a second, generic modal on top of
 * that would be redundant. This only ever fires for the two countable
 * monthly metrics (assessments, applications).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onLimitReached, LimitReachedPayload } from '@/lib/limitReachedBus';

const METRIC_LABEL: Record<string, string> = {
  assessments: 'assessment starts',
  applications: 'job applications',
};

function formatResetDate(resetsAt: string | null): string {
  if (!resetsAt) return '';
  return new Date(resetsAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

export default function LimitReachedModal() {
  const [payload, setPayload] = useState<LimitReachedPayload | null>(null);

  useEffect(() => {
    return onLimitReached((p) => {
      if (p.metric !== 'assessments' && p.metric !== 'applications') return;
      setPayload(p);
    });
  }, []);

  if (!payload) return null;

  const label = METRIC_LABEL[payload.metric] ?? payload.metric;
  const resetLine = payload.resetsAt ? ` — more open up on ${formatResetDate(payload.resetsAt)}` : '';

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setPayload(null)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <span className="eyebrow">Monthly limit reached</span>
        <h2 style={{ marginTop: 10, marginBottom: 8 }}>
          You&apos;ve used all {payload.limit ?? ''} of your {label} this month
        </h2>
        <p style={{ marginBottom: 20 }}>
          Free plans include {payload.limit} {label} per calendar month{resetLine}. Upgrade to Premium for
          unlimited {label} — no monthly wall.
        </p>
        <div className="row" style={{ margin: 0 }}>
          <Link href="/upgrade">
            <button>See Premium →</button>
          </Link>
          <button className="btn-secondary" onClick={() => setPayload(null)}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
