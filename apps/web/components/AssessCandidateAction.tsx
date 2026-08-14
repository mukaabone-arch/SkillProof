'use client';

/**
 * "Assess candidate" — per shortlisted candidate on EmployerShortlist. Skill
 * + level picker (sourced from GET /assessments, live MCQ assessments only —
 * the one fixed discussion skill+level, RAG Systems L2, isn't in that list
 * since it's synthesized separately in AssessmentsService.buildSkillBuckets;
 * requesting it here isn't offered as a known limitation, not a bug) →
 * POST /assessment-requests. Already-badged short-circuits with no charge
 * and no Checkout; otherwise opens Razorpay Checkout on the returned order
 * and verifies server-side on success.
 */
import { useEffect, useState } from 'react';
import Script from 'next/script';
import { employerApi } from '@/lib/api';
import { type RazorpayCheckoutResponse } from '@/lib/razorpay';

const { api } = employerApi;

interface LiveAssessment {
  id: string;
  skillId: string;
  targetLevel: 'L1' | 'L2' | 'L3' | 'L4';
  skill: { name: string; domain: { name: string } };
}

interface SkillLevelOption {
  skillId: string;
  level: 'L1' | 'L2' | 'L3' | 'L4';
  label: string;
}

type RequestStatus =
  | 'PAID_PENDING_START'
  | 'STARTED'
  | 'COMPLETED'
  | 'EXPIRED_REFUNDED'
  | 'REFUND_FAILED'
  | 'ALREADY_BADGED';

interface AssessmentRequestView {
  id: string;
  skillId: string;
  level: string;
  status: RequestStatus;
  badgeId: string | null;
  createdAt: string;
}

interface InitiateResponse {
  alreadyBadged: boolean;
  badge?: { id: string; verifyHash: string };
  requestId?: string;
  orderId?: string;
  keyId?: string;
  amount?: number;
  currency?: string;
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  PAID_PENDING_START: 'Invited — awaiting start',
  STARTED: 'In progress',
  COMPLETED: 'Result ready',
  EXPIRED_REFUNDED: 'Expired — refunded',
  REFUND_FAILED: 'Refund pending',
  ALREADY_BADGED: 'Already verified',
};

export default function AssessCandidateAction({ candidateId }: { candidateId: string }) {
  const [scriptReady, setScriptReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [assessments, setAssessments] = useState<LiveAssessment[]>([]);
  const [skillLevel, setSkillLevel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requests, setRequests] = useState<AssessmentRequestView[]>([]);

  useEffect(() => {
    api<AssessmentRequestView[]>(`/assessment-requests?candidateId=${candidateId}`)
      .then(setRequests)
      .catch(() => undefined);
  }, [candidateId]);

  function openPicker() {
    setOpen(true);
    setError('');
    setMessage('');
    if (assessments.length === 0) {
      api<LiveAssessment[]>('/assessments').then(setAssessments).catch(() => undefined);
    }
  }

  const options: SkillLevelOption[] = assessments
    .map((a) => ({ skillId: a.skillId, level: a.targetLevel, label: `${a.skill.name} — Level ${a.targetLevel} (${a.skill.domain.name})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  async function submit() {
    if (!skillLevel) return;
    const [skillId, level] = skillLevel.split('|');
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const result = await api<InitiateResponse>('/assessment-requests', {
        method: 'POST',
        body: JSON.stringify({ candidateId, skillId, level }),
      });

      if (result.alreadyBadged) {
        setMessage('This candidate already holds a verified badge at this level — no charge, nothing to pay for.');
        await refreshRequests();
        return;
      }

      if (!scriptReady || !window.Razorpay || !result.orderId || !result.keyId || !result.amount || !result.currency) {
        setError('Payment could not start — Razorpay is not ready. Please try again.');
        return;
      }

      const checkout = new window.Razorpay({
        key: result.keyId,
        amount: result.amount,
        currency: result.currency,
        order_id: result.orderId,
        name: 'MyAmbii — assessment request',
        description: `${(result.amount / 100).toFixed(2)} ${result.currency} — verified skill assessment`,
        theme: { color: '#5B4FE0' },
        handler: (response) => {
          void verify(response);
        },
      });
      checkout.open();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(response: RazorpayCheckoutResponse) {
    setBusy(true);
    try {
      await api('/assessment-requests/verify', { method: 'POST', body: JSON.stringify(response) });
      setMessage('Payment confirmed. The candidate has been invited — you’ll be notified when they start and when a result is ready.');
      await refreshRequests();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshRequests() {
    try {
      setRequests(await api<AssessmentRequestView[]>(`/assessment-requests?candidateId=${candidateId}`));
    } catch {
      // Non-critical — the confirmation message above already told the employer what happened.
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" onLoad={() => setScriptReady(true)} strategy="afterInteractive" />

      {requests.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {requests.map((r) => (
            <span key={r.id} className="ui-badge ui-badge-neutral">
              {STATUS_LABELS[r.status]} · {r.level}
            </span>
          ))}
        </div>
      )}

      {!open && (
        <button type="button" className="btn-secondary" onClick={openPicker}>
          Assess candidate
        </button>
      )}

      {open && (
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor={`assess-skill-${candidateId}`}>Verify this candidate at</label>
          <select id={`assess-skill-${candidateId}`} value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)}>
            <option value="">Choose a skill and level…</option>
            {options.map((o) => (
              <option key={`${o.skillId}|${o.level}`} value={`${o.skillId}|${o.level}`}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={submit} disabled={busy || !skillLevel}>
              {busy ? 'Working…' : 'Pay and invite candidate'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          <p className="meta">
            Free if they already hold this badge. Otherwise, they have 5 days to start — if they don&apos;t, you&apos;re
            automatically refunded.
          </p>
        </div>
      )}

      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
