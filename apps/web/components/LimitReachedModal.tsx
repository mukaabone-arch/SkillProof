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
 *
 * Mounted once at the app root (Providers.tsx) and never unmounted across
 * client-side navigation, so its state doesn't naturally reset on a route
 * change the way page-local state would — without the pathname effect
 * below, dismissing via "See Premium" (a plain Link to /upgrade) would
 * leave this exact modal sitting on top of the page it just linked to.
 * Clearing on every pathname change is the general fix ("no limit modal
 * ever survives a page transition"), not just a special case for that one
 * button.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    return onLimitReached((p) => {
      if (p.metric !== 'assessments' && p.metric !== 'applications') return;
      setPayload(p);
    });
  }, []);

  // Covers every way the page underneath can change out from under this
  // always-mounted modal — the "See Premium" Link, a nav click, the back
  // button — not just the one CTA. payload is already null on mount, so
  // this is a no-op the first time it runs.
  useEffect(() => {
    setPayload(null);
  }, [pathname]);

  if (!payload) return null;

  const label = METRIC_LABEL[payload.metric] ?? payload.metric;
  const resetLine = payload.resetsAt ? ` — more open up on ${formatResetDate(payload.resetsAt)}` : '';

  /**
   * The assessment take-flow page (/assessments/[id]) has nothing else to
   * show once the attempt it exists to run was blocked — plain dismissal
   * would strand the candidate on that empty page (it now renders its own
   * "limit reached" state rather than a raw error, but /assessments is
   * still the more useful place to land). The catalogue itself
   * (/assessments, no further segment) already has other assessments to
   * browse, so a plain in-place dismiss is fine there — this only
   * redirects out of a page that's specifically about the one blocked
   * assessment.
   */
  function dismiss() {
    if (payload?.metric === 'assessments' && pathname.startsWith('/assessments/')) {
      router.push('/assessments');
      return;
    }
    setPayload(null);
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={dismiss}>
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
          <button className="btn-secondary" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
