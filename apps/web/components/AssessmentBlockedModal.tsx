'use client';

/**
 * The one place a 403 { code: 'ASSESSMENT_BLOCKED' } response ever becomes
 * UI — subscribes to assessmentBlockedBus (populated by lib/api.ts on every
 * such response, from any call site) and renders a dedicated "assessments
 * are paused" prompt. Same architecture as LimitReachedModal — mounted once
 * at the app root (Providers.tsx), never unmounted across client-side
 * navigation, cleared on every pathname change so it never survives a page
 * transition.
 *
 * Copy requirements (2026-09 integrity-block spec) this exists to satisfy:
 * state that assessments are paused, state exactly when it ends (a resolved
 * timestamp, never a relative "24 hours" — the block's actual duration is
 * configurable and this must stay correct regardless), and how to contest
 * it. Must NOT enumerate which behaviours were detected — the server-side
 * error body itself carries only `expiresAt`, nothing else, so there is
 * nothing here to leak even by accident.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { onAssessmentBlocked, AssessmentBlockedPayload } from '@/lib/assessmentBlockedBus';

function formatResumeTime(expiresAt: string): string {
  return new Date(expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AssessmentBlockedModal() {
  const [payload, setPayload] = useState<AssessmentBlockedPayload | null>(null);
  const pathname = usePathname();

  useEffect(() => onAssessmentBlocked(setPayload), []);

  // Same "no modal survives a page transition" rule as LimitReachedModal —
  // payload is already null on mount, so this is a no-op the first time it runs.
  useEffect(() => {
    setPayload(null);
  }, [pathname]);

  if (!payload) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setPayload(null)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <span className="eyebrow">Assessments paused</span>
        <h2 style={{ marginTop: 10, marginBottom: 8 }}>New assessments are temporarily paused on your account</h2>
        <p style={{ marginBottom: 8 }}>
          This is automatic and temporary — it lifts on its own on <strong>{formatResumeTime(payload.expiresAt)}</strong>.
          Any assessment you already had in progress is unaffected and can still be finished.
        </p>
        <p style={{ marginBottom: 20 }}>
          If you think this is a mistake,{' '}
          <Link href="/contact">contact us</Link> and we&apos;ll take a look.
        </p>
        <div className="row" style={{ margin: 0 }}>
          <button className="btn-secondary" onClick={() => setPayload(null)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
