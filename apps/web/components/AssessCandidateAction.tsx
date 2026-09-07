'use client';

/**
 * "Assess candidate" — per shortlisted candidate on EmployerShortlist. Skill
 * + level picker (sourced from GET /assessments, live MCQ assessments only —
 * the one fixed discussion skill+level, RAG Systems L2, isn't in that list
 * since it's synthesized separately in AssessmentsService.buildSkillBuckets;
 * requesting it here isn't offered as a known limitation, not a bug) →
 * confirm the accrual amount → POST /assessment-requests. Already-badged
 * short-circuits with no charge at all.
 *
 * Postpaid (2026-09, replacing the original prepaid Razorpay flow): no
 * payment gateway anywhere in this component — the amount is fetched from
 * GET /plans-adjacent pricing (hardcoded here, matching the server's own
 * ₹150+18% GST default — see AssessmentRequestsService.chargeAmountPaise)
 * and shown explicitly before the employer confirms, since there's no
 * Checkout screen left to double as that disclosure. A surprise invoice
 * line item is not acceptable — see this component's own confirmation step
 * below.
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

/** ₹150 base + 18% GST = ₹177 — mirrors AssessmentRequestsService's own DEFAULT_BASE_AMOUNT_PAISE/chargeAmountPaise exactly. Server-decided and server-enforced regardless of what this constant says; shown here purely so the employer sees the real number before confirming, not to compute anything sent to the API. */
const DISPLAY_BASE_PAISE = 15000;
const DISPLAY_GST_PAISE = 2700;
const DISPLAY_TOTAL_PAISE = DISPLAY_BASE_PAISE + DISPLAY_GST_PAISE;

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

type RequestStatus = 'ACCRUED_PENDING_START' | 'STARTED' | 'COMPLETED' | 'EXPIRED_UNBILLED' | 'ALREADY_BADGED';

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

interface CreateResponse {
  alreadyBadged: boolean;
  badge?: { id: string; verifyHash: string };
  requestId?: string;
  amount?: number;
  currency?: string;
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  ACCRUED_PENDING_START: 'Awaiting start',
  STARTED: 'In progress',
  COMPLETED: 'Result ready',
  EXPIRED_UNBILLED: 'Expired — not billed',
  ALREADY_BADGED: 'Already verified',
};

export default function AssessCandidateAction({ candidateId }: { candidateId: string }) {
  const [open, setOpen] = useState(false);
  const [assessments, setAssessments] = useState<LiveAssessment[]>([]);
  const [skillLevel, setSkillLevel] = useState('');
  // Gates the actual POST behind an explicit second confirmation once a
  // skill+level is chosen — the disclosure step this component exists to
  // guarantee (see this file's own doc comment). Reset whenever the
  // picker is reopened or the selection changes, so a stale confirmation
  // can never carry over to a different skill+level.
  const [confirmed, setConfirmed] = useState(false);
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
    setConfirmed(false);
    setError('');
    setMessage('');
    if (assessments.length === 0) {
      api<LiveAssessment[]>('/assessments').then(setAssessments).catch(() => undefined);
    }
  }

  const options: SkillLevelOption[] = assessments
    .map((a) => ({ skillId: a.skillId, level: a.targetLevel, label: `${a.skill.name} — Level ${a.targetLevel} (${a.skill.domain.name})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const selectedLabel = options.find((o) => `${o.skillId}|${o.level}` === skillLevel)?.label ?? '';

  async function submit() {
    if (!skillLevel) return;
    const [skillId, level] = skillLevel.split('|');
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const result = await api<CreateResponse>('/assessment-requests', {
        method: 'POST',
        body: JSON.stringify({ candidateId, skillId, level }),
      });

      if (result.alreadyBadged) {
        setMessage('This candidate already holds a verified badge at this level — no charge, nothing added to your invoice.');
      } else {
        setMessage(
          `Candidate invited. ${rupees(result.amount ?? DISPLAY_TOTAL_PAISE)} has been added to your organization's account and will appear on your monthly invoice.`,
        );
      }
      setOpen(false);
      setSkillLevel('');
      setConfirmed(false);
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
              <span
                key={r.id}
                className="ui-badge ui-badge-neutral chip-truncate"
                style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
                title={`${r.skill.name} (${r.level}) · ${STATUS_LABELS[r.status]}`}
              >
                {r.skill.name} ({r.level}) · {STATUS_LABELS[r.status]}
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
          <select
            id={`assess-skill-${candidateId}`}
            value={skillLevel}
            onChange={(e) => {
              setSkillLevel(e.target.value);
              setConfirmed(false); // a new selection needs its own confirmation
            }}
          >
            <option value="">Choose a skill and level…</option>
            {options.map((o) => (
              <option key={`${o.skillId}|${o.level}`} value={`${o.skillId}|${o.level}`}>
                {o.label}
              </option>
            ))}
          </select>

          {skillLevel && (
            <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 8 }}>
              <p style={{ margin: 0 }}>
                This adds <strong>{rupees(DISPLAY_TOTAL_PAISE)}</strong> ({rupees(DISPLAY_BASE_PAISE)} + 18% GST) to your
                organization&apos;s account for <strong>{selectedLabel}</strong>, invoiced monthly and settled by bank
                transfer. Free if the candidate already holds this badge — you&apos;ll see that before anything is added.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I understand this
                will appear on my organization&apos;s next invoice.
              </label>
            </div>
          )}

          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={submit} disabled={busy || !skillLevel || !confirmed}>
              {busy ? 'Working…' : 'Invite candidate'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
