'use client';

/**
 * "Assess candidate" — per shortlisted candidate on EmployerShortlist. Skill
 * picker (sourced from GET /assessments, live MCQ assessments only — the one
 * fixed discussion skill+level, RAG Systems L2, isn't in that list since
 * it's synthesized separately in AssessmentsService.buildSkillBuckets;
 * requesting it here isn't offered as a known limitation, not a bug) →
 * confirm the outcome-dependent charge → POST /assessment-requests.
 * Already-badged-at-every-level short-circuits with no charge at all.
 *
 * Whole-skill, outcome-priced (2026-09-14 rework, replacing the original
 * one-skill-one-level-flat-₹177 model): the candidate works through all
 * three levels the skill offers, in any order, and what it costs depends on
 * how far they get — ₹0/₹150+GST/₹500+GST (see this component's own
 * disclosure copy below). Nothing is known or charged at request time, so
 * unlike the old flow there is no single "amount" to show after submitting
 * — only the three possible outcomes, up front, before the employer
 * confirms. See AssessmentRequestsService.settle on the API side for
 * exactly when and how the real charge is decided.
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

/**
 * Mirrors AssessmentRequestsService's own DEFAULT_BASE_AMOUNT_PAISE /
 * COMPLETE_DEFAULT_BASE_AMOUNT_PAISE exactly. Server-decided and
 * server-enforced regardless of what these constants say — shown here
 * purely so the employer sees the real numbers before confirming, not to
 * compute anything sent to the API (this request never sends an amount at
 * all now — see submit() below).
 */
const DISPLAY_PARTIAL_BASE_PAISE = 15000; // ₹150 — started, not all three levels attempted
const DISPLAY_PARTIAL_TOTAL_PAISE = 17700;
const DISPLAY_COMPLETE_BASE_PAISE = 50000; // ₹500 — all three levels attempted
const DISPLAY_COMPLETE_TOTAL_PAISE = 59000;

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface LiveAssessment {
  id: string;
  skillId: string;
  targetLevel: 'L1' | 'L2' | 'L3' | 'L4';
  skill: { name: string; domain: { name: string } };
}

interface SkillOption {
  skillId: string;
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

/** One level's outcome within a whole-skill request — present only on a `level: null` (whole-skill) row, see AssessmentRequestView.levels. */
interface LevelOutcomeView {
  level: string;
  attempted: boolean;
  passed: boolean | null;
  scorePercent: number | null;
  topicBreakdown: TopicBreakdownView | null;
}

interface AssessmentRequestView {
  id: string;
  skillId: string;
  skill: { name: string };
  /** Null for a whole-skill request (2026-09-14 rework) — see `levels` below instead of the flat fields that follow. Set only on a legacy row that predates the rework. */
  level: string | null;
  status: RequestStatus;
  createdAt: string;
  /** Legacy (level set) only. */
  badgeId: string | null;
  passed: boolean | null;
  badge: { verifyHash: string; level: string; expiresAt: string } | null;
  scorePercent: number | null;
  topicBreakdown: TopicBreakdownView | null;
  /** Whole-skill (level: null) only — one entry per level the skill offers. */
  levels?: LevelOutcomeView[];
}

interface CreateResponse {
  alreadyBadged: boolean;
  requestId?: string;
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
  const [selectedSkillId, setSelectedSkillId] = useState('');
  // Gates the actual POST behind an explicit second confirmation once a
  // skill is chosen — the disclosure step this component exists to
  // guarantee (see this file's own doc comment). Reset whenever the picker
  // is reopened or the selection changes, so a stale confirmation can
  // never carry over to a different skill.
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

  const options: SkillOption[] = Array.from(
    new Map(assessments.map((a) => [a.skillId, { skillId: a.skillId, label: `${a.skill.name} (${a.skill.domain.name})` }])).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  const selectedLabel = options.find((o) => o.skillId === selectedSkillId)?.label ?? '';

  async function submit() {
    if (!selectedSkillId) return;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const result = await api<CreateResponse>('/assessment-requests', {
        method: 'POST',
        body: JSON.stringify({ candidateId, skillId: selectedSkillId }),
      });

      if (result.alreadyBadged) {
        setMessage('This candidate already holds verified badges at every level of this skill — no charge, nothing added to your invoice.');
      } else {
        setMessage(
          `Candidate invited to verify ${selectedLabel} across all three levels. The charge — ₹0, ${rupees(DISPLAY_PARTIAL_TOTAL_PAISE)}, or ${rupees(DISPLAY_COMPLETE_TOTAL_PAISE)} — depends on how far they get, and will appear on a future invoice once it's known.`,
        );
      }
      setOpen(false);
      setSelectedSkillId('');
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
          {requests.map((r) => (r.level !== null ? <LegacyRequestRow key={r.id} r={r} /> : <WholeSkillRequestRow key={r.id} r={r} />))}
        </div>
      )}

      {!open && (
        <button type="button" className="btn-secondary" onClick={openPicker}>
          Assess candidate
        </button>
      )}

      {open && (
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor={`assess-skill-${candidateId}`}>Verify this candidate in</label>
          <select
            id={`assess-skill-${candidateId}`}
            value={selectedSkillId}
            onChange={(e) => {
              setSelectedSkillId(e.target.value);
              setConfirmed(false); // a new selection needs its own confirmation
            }}
          >
            <option value="">Choose a skill…</option>
            {options.map((o) => (
              <option key={o.skillId} value={o.skillId}>
                {o.label}
              </option>
            ))}
          </select>

          {selectedSkillId && (
            <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 8 }}>
              <p style={{ margin: 0 }}>
                This verifies the candidate in <strong>{selectedLabel}</strong> across all three levels (Foundational,
                Practitioner, Advanced) — they can attempt them in any order. What it adds to your organization&apos;s
                account depends on how far they get:
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>Doesn&apos;t start within 5 days — <strong>₹0</strong>, nothing added.</li>
                <li>
                  Starts but doesn&apos;t attempt all three levels within 14 days of starting —{' '}
                  <strong>{rupees(DISPLAY_PARTIAL_TOTAL_PAISE)}</strong> ({rupees(DISPLAY_PARTIAL_BASE_PAISE)} + 18% GST).
                </li>
                <li>
                  Attempts all three levels — <strong>{rupees(DISPLAY_COMPLETE_TOTAL_PAISE)}</strong> (
                  {rupees(DISPLAY_COMPLETE_BASE_PAISE)} + 18% GST).
                </li>
              </ul>
              <p className="meta" style={{ margin: 0 }}>
                Free for any level the candidate already holds a verified badge for — you&apos;ll see that before
                anything is added. Invoiced monthly, settled by bank transfer.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I understand
                the charge depends on how far the candidate gets, and will appear on my organization&apos;s next invoice.
              </label>
            </div>
          )}

          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={submit} disabled={busy || !selectedSkillId || !confirmed}>
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

/** Unchanged rendering for a legacy (level set) request — frozen shape from before the 2026-09-14 rework. */
function LegacyRequestRow({ r }: { r: AssessmentRequestView }) {
  if (r.status !== 'COMPLETED') {
    return (
      <span
        className="ui-badge ui-badge-neutral chip-truncate"
        style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
        title={`${r.skill.name} (${r.level}) · ${STATUS_LABELS[r.status]}`}
      >
        {r.skill.name} ({r.level}) · {STATUS_LABELS[r.status]}
      </span>
    );
  }
  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: 10 }}>
      <div className="row" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
        <span className={`ui-badge ${r.passed ? 'ui-badge-verified' : 'ui-badge-danger'}`}>{r.passed ? 'Passed' : 'Not passed'}</span>
        <strong>
          {r.skill.name} — {r.level}
        </strong>
        {r.scorePercent !== null && <span className="meta" style={{ margin: 0 }}>Score: {r.scorePercent}%</span>}
      </div>
      {/*
        scorePercent/topicBreakdown are null (not 0 / not an empty list) for
        a DISCUSSION-format request — this section is entirely absent for
        that case rather than rendering a misleading "0% — no topics" block.
      */}
      {r.topicBreakdown && r.topicBreakdown.topics.length > 0 && (
        <details className="hint-toggle">
          <summary>Performance by topic</summary>
          {r.topicBreakdown.excludedCount > 0 && (
            <p className="meta" style={{ marginTop: 4 }}>
              {r.topicBreakdown.excludedCount} question{r.topicBreakdown.excludedCount === 1 ? '' : 's'} weren&apos;t part of a
              tracked topic and aren&apos;t included below.
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
  );
}

/** A whole-skill request — shows per-level pass/fail/score once any level has an outcome, regardless of whether the request as a whole has settled yet (an employer can see "Foundational: passed" while Practitioner/Advanced are still outstanding). */
function WholeSkillRequestRow({ r }: { r: AssessmentRequestView }) {
  const levels = r.levels ?? [];
  const anyOutcome = levels.some((l) => l.attempted);

  if (r.status !== 'COMPLETED' && !anyOutcome) {
    return (
      <span
        className="ui-badge ui-badge-neutral chip-truncate"
        style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
        title={`${r.skill.name} · ${STATUS_LABELS[r.status]}`}
      >
        {r.skill.name} · {STATUS_LABELS[r.status]}
      </span>
    );
  }

  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: 10 }}>
      <div className="row" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
        <strong>{r.skill.name}</strong>
        <span className="meta" style={{ margin: 0 }}>
          {r.status === 'COMPLETED' ? 'Settled' : STATUS_LABELS[r.status]}
        </span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {levels.map((l) => (
          <li key={l.level} className="meta">
            {l.level}:{' '}
            {l.attempted ? (
              <span className={l.passed ? 'ok' : 'error'}>
                {l.passed ? 'Passed' : 'Not passed'}
                {l.scorePercent !== null ? ` (${l.scorePercent}%)` : ''}
              </span>
            ) : (
              'Not attempted'
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
