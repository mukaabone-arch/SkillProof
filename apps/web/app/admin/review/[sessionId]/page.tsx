'use client';

/**
 * PLATFORM_ADMIN case page for one AI-scored session. The anti-anchoring
 * rule is enforced server-side (GET .../review never sends modelVerdict/
 * modelReason for an unreviewed claim) — this page has no way to "peek"
 * even if it wanted to; there's simply nothing to show until the reviewer's
 * own verdict is already committed.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import AdminNav from '@/components/AdminNav';
import { Badge, LoadingState } from '@/components/ui';

interface Span {
  quote: string;
  probeContext: string;
}

interface ReviewClaim {
  claimId: string;
  spans: Span[];
  bandBoundary: boolean;
  reviewed: boolean;
  reviewerVerdict: string | null;
  reviewerNote: string | null;
  reviewedAt: string | null;
  modelVerdict?: string;
  modelReason?: string;
  agree?: boolean;
}

interface TranscriptTurn {
  id: string;
  role: 'CANDIDATE' | 'ASSESSOR';
  content: string;
  claimId: string | null;
  probeRung: string | null;
  superseded: boolean;
  isReflection: boolean;
  createdAt: string;
}

interface Interruption {
  occurredAt: string;
  resumedAt: string | null;
  fragmentTurnId: string | null;
}

interface DecisionPreview {
  eligible: boolean;
  blockedByInsufficientProbing: boolean;
  demonstratedCount: number;
  gatingClaimCount: number;
  reason: string | null;
}

interface ReviewCase {
  sessionId: string;
  candidateId: string;
  status: string;
  skill: string;
  level: string;
  durationMinutes: number | null;
  completedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  reviewedCount: number;
  totalClaims: number;
  decisionPreview: DecisionPreview | null;
  interruptions: Interruption[];
  claims: ReviewClaim[];
  transcript: TranscriptTurn[];
}

interface IssuedBadge {
  verifyHash: string;
  level: string;
  expiresAt: string;
}

const CLAIM_LABELS: Record<string, string> = {
  CHUNKING: 'Chunking strategy',
  DIAGNOSIS: 'Diagnosing retrieval quality issues',
  RERANKING: 'Reranking and relevance under the latency budget',
  CORPUS_CHANGE: 'Handling the hourly-changing corpus',
  EVALUATION: 'Evaluating retrieval quality before shipping',
  COST: 'Cost tradeoffs at scale',
};

const VERDICT_OPTIONS: { value: string; label: string }[] = [
  { value: 'DEMONSTRATED', label: 'Demonstrated' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'NOT_EVIDENCED', label: 'Not evidenced' },
  { value: 'ABSTAIN', label: 'Abstain' },
  { value: 'INSUFFICIENT_PROBING', label: 'Insufficient probing' },
];

/**
 * Claim ordering for the case page. A claim "needs your judgement" when the
 * model flagged it as a band boundary OR there was no evidence to work
 * from at all (an empty spans list) — both are exactly the cases where a
 * reviewer's independent read matters most. Everything else is "clear" and
 * collapses below. Array.prototype.sort is stable in every JS engine this
 * app runs on, and the server already returns `claims` in CLAIM_ORDER, so
 * ties (same bucket) keep that original chunking→cost order — this
 * function only ever moves the needs-judgement claims in front of it.
 */
function needsJudgement(claim: ReviewClaim): boolean {
  return claim.bandBoundary || claim.spans.length === 0;
}
function sortClaimsForReview(claims: ReviewClaim[]): ReviewClaim[] {
  return [...claims].sort((a, b) => Number(needsJudgement(b)) - Number(needsJudgement(a)));
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export default function ReviewCasePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [data, setData] = useState<ReviewCase | null>(null);
  const [error, setError] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  const [submittingClaim, setSubmittingClaim] = useState<string | null>(null);

  const [decisionNote, setDecisionNote] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [issuedBadge, setIssuedBadge] = useState<IssuedBadge | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await api<ReviewCase>(`/assessment-sessions/${sessionId}/review`);
      setData(c);
      setStatus('ok');
    } catch {
      setStatus('forbidden');
    }
  }, [sessionId]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, [load]);

  async function submitVerdict(claimId: string, verdict: string) {
    setSubmittingClaim(claimId);
    setClaimErrors((prev) => ({ ...prev, [claimId]: '' }));
    try {
      const note = noteDrafts[claimId]?.trim() || undefined;
      await api(`/assessment-sessions/${sessionId}/claims/${claimId}/review`, {
        method: 'POST',
        body: JSON.stringify({ verdict, note }),
      });
      await load();
    } catch (e) {
      // The 400 message itself is the "add a note" prompt for the
      // two-band-disagreement rule — surfaced verbatim next to the note field.
      setClaimErrors((prev) => ({ ...prev, [claimId]: (e as Error).message }));
    } finally {
      setSubmittingClaim(null);
    }
  }

  async function submitDecision(decision: 'ISSUE' | 'REJECT') {
    if (decision === 'ISSUE' && !window.confirm('Issue this badge? This mints a real, verifiable credential for the candidate.')) {
      return;
    }
    setDecisionSubmitting(true);
    setDecisionError('');
    try {
      const result = await api<{ session: { status: string }; badge: IssuedBadge | null }>(
        `/assessment-sessions/${sessionId}/decision`,
        { method: 'POST', body: JSON.stringify({ decision, note: decisionNote.trim() || undefined }) },
      );
      if (result.badge) setIssuedBadge(result.badge);
      await load();
    } catch (e) {
      setDecisionError((e as Error).message);
    } finally {
      setDecisionSubmitting(false);
    }
  }

  if (status === 'loading') {
    return (
      <main className="hub">
        <LoadingState />
      </main>
    );
  }
  if (status === 'forbidden' || !data) {
    return (
      <main className="hub">
        <p className="error">Admins only, or this session hasn't been scored yet.</p>
      </main>
    );
  }

  const orderedClaims = sortClaimsForReview(data.claims);
  const firstClearIndex = orderedClaims.findIndex((c) => !needsJudgement(c));
  const judgementClaims = firstClearIndex === -1 ? orderedClaims : orderedClaims.slice(0, firstClearIndex);
  const clearClaims = firstClearIndex === -1 ? [] : orderedClaims.slice(firstClearIndex);
  const allReviewed = data.reviewedCount === data.totalClaims;

  function renderClaim(claim: ReviewClaim) {
    return (
      <div key={claim.claimId} className="ui-card review-claim-card">
        <div className="assessment-row" style={{ marginBottom: 8 }}>
          <strong>{CLAIM_LABELS[claim.claimId] ?? claim.claimId}</strong>
          {claim.bandBoundary && <Badge variant="warning">band boundary</Badge>}
        </div>

        {claim.spans.length === 0 ? (
          <p className="meta">No evidence extracted for this competency.</p>
        ) : (
          <ol className="review-span-list">
            {claim.spans.map((s, i) => (
              <li key={i} className="review-span">
                <blockquote>&ldquo;{s.quote}&rdquo;</blockquote>
                <span className="chip">seq {i + 1} · {s.probeContext}</span>
              </li>
            ))}
          </ol>
        )}

        {!claim.reviewed ? (
          <div className="review-verdict-panel">
            <div className="field">
              <label htmlFor={`note-${claim.claimId}`}>Note (required if your verdict diverges sharply)</label>
              <textarea
                id={`note-${claim.claimId}`}
                rows={2}
                value={noteDrafts[claim.claimId] ?? ''}
                onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [claim.claimId]: e.target.value }))}
              />
            </div>
            {claimErrors[claim.claimId] && <p className="error">{claimErrors[claim.claimId]}</p>}
            <div className="review-verdict-buttons">
              {VERDICT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className="btn btn-secondary"
                  disabled={submittingClaim === claim.claimId}
                  onClick={() => submitVerdict(claim.claimId, opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={`review-reveal ${claim.agree ? 'review-reveal-agree' : 'review-reveal-disagree'}`}>
            <div className="assessment-row">
              <span>
                Your verdict: <strong>{claim.reviewerVerdict}</strong>
              </span>
              <Badge variant={claim.agree ? 'verified' : 'warning'}>{claim.agree ? '✓ agrees with model' : '⚠ disagrees with model'}</Badge>
            </div>
            {claim.reviewerNote && <p className="meta">Your note: {claim.reviewerNote}</p>}
            <div className="review-model-block">
              <strong>Model verdict:</strong> {claim.modelVerdict}
              <p className="meta">{claim.modelReason}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <AdminNav onLoggedOut={() => router.push('/')} />
      <main className="hub">
        <p>
          <Link href="/admin/review">← Back to queue</Link>
        </p>
        <h1>Case {data.sessionId.slice(0, 8)}</h1>
        <p className="hub-subhead">
          {data.skill} · {data.level} · {data.durationMinutes != null ? `${data.durationMinutes} min` : 'duration unknown'} ·
          completed {fmtDate(data.completedAt)} · status <strong>{data.status}</strong>
        </p>
        {error && <p className="error">{error}</p>}

        {data.interruptions.length > 0 && (
          <div className="interruption-banner">
            This session was interrupted {data.interruptions.length} time{data.interruptions.length === 1 ? '' : 's'}. Each
            interruption re-asks the same probe after a break — this is a connectivity note, not a signal about the candidate.
            <ul>
              {data.interruptions.map((i, idx) => (
                <li key={idx} className="meta">
                  Broke at {fmtDate(i.occurredAt)}, {i.resumedAt ? `resumed at ${fmtDate(i.resumedAt)}` : 'not yet resumed'}.
                </li>
              ))}
            </ul>
          </div>
        )}

        {judgementClaims.length > 0 && (
          <div className="hub-section">
            <div className="hub-section-head">
              <h2>Needs your judgement</h2>
            </div>
            {judgementClaims.map(renderClaim)}
          </div>
        )}

        {clearClaims.length > 0 && (
          <details className="hint-toggle review-clear-claims">
            <summary>Clear claims ({clearClaims.length})</summary>
            {clearClaims.map(renderClaim)}
          </details>
        )}

        {allReviewed && data.decisionPreview && (
          <div className="ui-card ui-card-elevated review-decision-panel">
            <h2>Decision</h2>
            {data.status !== 'AWAITING_REVIEW' ? (
              <p>
                Already decided: <strong>{data.status}</strong> at {fmtDate(data.decidedAt)}
                {data.decisionNote && ` — "${data.decisionNote}"`}
              </p>
            ) : (
              <>
                {data.decisionPreview.blockedByInsufficientProbing ? (
                  <p className="error">
                    Blocked: {data.decisionPreview.reason} The candidate should be offered a re-take, not rejected.
                  </p>
                ) : data.decisionPreview.eligible ? (
                  <p className="ok">
                    Eligible for ISSUE — {data.decisionPreview.demonstratedCount}/{data.decisionPreview.gatingClaimCount} gating
                    claims demonstrated.
                  </p>
                ) : (
                  <p className="error">Not eligible for ISSUE: {data.decisionPreview.reason}</p>
                )}

                <div className="field">
                  <label htmlFor="decision-note">Decision note (optional for ISSUE, recommended for REJECT)</label>
                  <textarea id="decision-note" rows={2} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
                </div>
                {decisionError && <p className="error">{decisionError}</p>}

                <div className="row">
                  <button
                    className="btn btn-primary"
                    disabled={decisionSubmitting || !data.decisionPreview.eligible}
                    onClick={() => submitDecision('ISSUE')}
                  >
                    Issue badge
                  </button>
                  <button className="btn btn-danger" disabled={decisionSubmitting} onClick={() => submitDecision('REJECT')}>
                    Reject
                  </button>
                </div>
              </>
            )}

            {issuedBadge && (
              <p className="ok">
                Badge issued — <Link href={`/badges/${issuedBadge.verifyHash}`}>view certificate</Link>
              </p>
            )}
          </div>
        )}

        <details className="hint-toggle" open={showTranscript} onToggle={(e) => setShowTranscript((e.target as HTMLDetailsElement).open)}>
          <summary>Full transcript ({data.transcript.length} turns)</summary>
          {data.transcript.map((t) => (
            <div key={t.id} className="transcript-turn" style={t.superseded ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
              <div className="meta">
                {t.role} {t.claimId ? `· ${t.claimId}/${t.probeRung}` : ''} {t.isReflection && '· reflection (unscored context)'}{' '}
                {t.superseded && '· superseded (re-asked after a break)'}
              </div>
              <p style={{ margin: '4px 0 12px' }}>{t.content}</p>
            </div>
          ))}
        </details>
      </main>
    </>
  );
}
