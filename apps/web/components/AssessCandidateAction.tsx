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

interface TopicStat {
  topic: string;
  correct: number;
  asked: number;
}
/** Aggregate counts only — see AssessmentsService.getScoreAndTopicBreakdown / topic-breakdown.ts on the API side for why this can never carry per-question detail. */
interface TopicBreakdownView {
  topics: TopicStat[];
  excludedCount: number;
}

interface AssessmentRequestView {
  id: string;
  skillId: string;
  skill: { name: string };
  level: string;
  status: RequestStatus;
  badgeId: string | null;
  createdAt: string;
  /** null until COMPLETED — not derivable from badgeId alone client-side, since a null badgeId means either "not done yet" or "done, didn't pass". */
  passed: boolean | null;
  badge: { verifyHash: string; level: string; expiresAt: string } | null;
  /**
   * Present only for a completed TEST-format (MCQ) request — null, not 0,
   * for a DISCUSSION-format one (RAG Systems L2), which has no score/topic
   * concept at all. Must render as "not applicable", never as a 0% result.
   */
  scorePercent: number | null;
  topicBreakdown: TopicBreakdownView | null;
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {requests.map((r) =>
            r.status === 'COMPLETED' ? (
              <div key={r.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: 10 }}>
                <div className="row" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
                  <span className={`ui-badge ${r.passed ? 'ui-badge-verified' : 'ui-badge-danger'}`}>
                    {r.passed ? 'Passed' : 'Not passed'}
                  </span>
                  <strong>
                    {r.skill.name} — {r.level}
                  </strong>
                  {r.scorePercent !== null && <span className="meta" style={{ margin: 0 }}>Score: {r.scorePercent}%</span>}
                </div>
                {/*
                  scorePercent/topicBreakdown are null (not 0 / not an empty
                  list) for a DISCUSSION-format request — this section is
                  entirely absent for that case rather than rendering a
                  misleading "0% — no topics" block. Only ever the requesting
                  employer sees this at all (GET /assessment-requests is
                  orgId-scoped) — a browsing employer only ever sees the badge.
                */}
                {r.topicBreakdown && r.topicBreakdown.topics.length > 0 && (
                  <details className="hint-toggle">
                    <summary>Performance by topic</summary>
                    {r.topicBreakdown.excludedCount > 0 && (
                      <p className="meta" style={{ marginTop: 4 }}>
                        {r.topicBreakdown.excludedCount} question{r.topicBreakdown.excludedCount === 1 ? '' : 's'} weren&apos;t
                        part of a tracked topic and aren&apos;t included below.
                      </p>
                    )}
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {r.topicBreakdown.topics.map((t) => (
                        <li key={t.topic} className="meta">
                          {t.topic}: {t.correct}/{t.asked} correct
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ) : (
              <span key={r.id} className="ui-badge ui-badge-neutral" style={{ alignSelf: 'flex-start' }}>
                {STATUS_LABELS[r.status]} · {r.level}
              </span>
            ),
          )}
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
