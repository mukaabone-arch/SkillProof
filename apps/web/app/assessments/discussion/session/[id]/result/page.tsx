'use client';

/**
 * Results page — only ever reachable once a session is ISSUED/REJECTED/
 * DISPUTED (GET .../result 404s before that). Renders only the reviewer's
 * own verdicts and reasoning; the model's original verdict/reason never
 * leave the server (see AssessmentSessionsService.getResult). No
 * CandidateNav, matching the rest of this flow.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { Badge } from '@/components/ui';

interface ResultClaim {
  claimId: string;
  verdict: string;
  reason: string;
  gates: boolean;
  disputed: boolean;
  disputeResolved: boolean;
}
interface ResultBadge {
  verifyHash: string;
  level: string;
  expiresAt: string;
}
interface Turn {
  id: string;
  role: string;
  content: string;
  superseded: boolean;
  createdAt: string;
}
interface ResultPayload {
  sessionId: string;
  status: string;
  outcome: 'ISSUED' | 'REJECTED' | 'DISPUTED' | 'INSUFFICIENT_PROBING';
  skill: string;
  level: string;
  decidedAt?: string | null;
  decisionNote?: string | null;
  // Only ever set for a plain REJECTED outcome — null for
  // INSUFFICIENT_PROBING (immediate, free retake) and for ISSUED/DISPUTED
  // (no retake concept there).
  retakeAvailableAt?: string | null;
  claims?: ResultClaim[];
  badge: ResultBadge | null;
  transcript?: Turn[];
}

const CLAIM_LABELS: Record<string, string> = {
  CHUNKING: 'Chunking strategy',
  DIAGNOSIS: 'Diagnosing retrieval quality issues',
  RERANKING: 'Reranking and relevance under the latency budget',
  CORPUS_CHANGE: 'Handling the hourly-changing corpus',
  EVALUATION: 'Evaluating retrieval quality before shipping',
  COST: 'Cost tradeoffs at scale',
};

function verdictIcon(v: string): string {
  if (v === 'DEMONSTRATED') return '✓';
  if (v === 'NOT_EVIDENCED') return '✗';
  return '◐'; // PARTIAL, ABSTAIN, INSUFFICIENT_PROBING (rare, non-gating)
}

export default function DiscussionResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ResultPayload | null>(null);
  const [error, setError] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [disputeOpenFor, setDisputeOpenFor] = useState<string | null>(null);
  const [disputeBody, setDisputeBody] = useState('');
  const [disputeError, setDisputeError] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [retaking, setRetaking] = useState(false);

  const load = useCallback(async () => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    try {
      setData(await api<ResultPayload>(`/assessment-sessions/${id}/result`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitDispute(claimId: string) {
    if (!disputeBody.trim()) {
      setDisputeError("Tell us what's wrong, and what you actually said if it helps.");
      return;
    }
    setDisputeSubmitting(true);
    setDisputeError('');
    try {
      await api(`/assessment-sessions/${id}/claims/${claimId}/dispute`, {
        method: 'POST',
        body: JSON.stringify({ body: disputeBody.trim() }),
      });
      setDisputeOpenFor(null);
      setDisputeBody('');
      await load();
    } catch (e) {
      setDisputeError((e as Error).message);
    } finally {
      setDisputeSubmitting(false);
    }
  }

  async function retake() {
    setRetaking(true);
    setError('');
    try {
      const created = await api<{ session: { id: string } }>('/assessment-sessions', { method: 'POST' });
      router.push(`/assessments/discussion/session/${created.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setRetaking(false);
    }
  }

  if (error) {
    return (
      <main>
        <p className="error">{error}</p>
        <Link href="/assessments">← Back to assessments</Link>
      </main>
    );
  }
  if (!data) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  // The assessor failed to elicit evidence on a required claim — a verdict
  // about the session, not the candidate. No per-claim verdicts are shown
  // at all; the only honest response is a fresh, no-fault attempt.
  if (data.outcome === 'INSUFFICIENT_PROBING') {
    return (
      <main>
        <h1>This session didn&apos;t give you a fair chance to show this skill</h1>
        <p>
          Something in how the conversation went meant we couldn&apos;t properly assess part of it. That&apos;s on
          us, not you — you&apos;re welcome to a fresh attempt.
        </p>
        <button onClick={retake} disabled={retaking}>
          {retaking ? 'Starting…' : "This session didn't give you a fair shot — retake now"}
        </button>
        <p style={{ marginTop: 16 }}>
          <Link href="/assessments">← Back to assessments</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>
        {data.skill} · Level {data.level}
      </h1>
      <p className={data.outcome === 'ISSUED' ? 'ok' : data.outcome === 'DISPUTED' ? 'meta' : 'error'}>
        {data.outcome === 'ISSUED' ? 'Badge issued' : data.outcome === 'DISPUTED' ? 'Under further review' : 'Not this time'}
      </p>

      {data.outcome === 'REJECTED' &&
        (data.retakeAvailableAt && new Date(data.retakeAvailableAt).getTime() > Date.now() ? (
          <p className="meta">Retake available from {new Date(data.retakeAvailableAt).toLocaleDateString()}.</p>
        ) : (
          <button onClick={retake} disabled={retaking}>
            {retaking ? 'Starting…' : 'Retake assessment'}
          </button>
        ))}
      {data.outcome === 'DISPUTED' && <p className="meta">Available after your dispute is resolved.</p>}

      {data.badge && (
        <div className="card badge-card">
          <div>
            <strong>
              ✓ Verified: {data.skill} ({data.badge.level})
            </strong>
            <div className="meta">Valid until {new Date(data.badge.expiresAt).toLocaleDateString()}</div>
          </div>
          <Link href={`/badges/${data.badge.verifyHash}`}>
            <button>View your verified certificate</button>
          </Link>
        </div>
      )}

      <div className="hub-section">
        {data.claims?.map((c) => (
          <div key={c.claimId} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="assessment-row">
              <strong>
                {verdictIcon(c.verdict)} {CLAIM_LABELS[c.claimId] ?? c.claimId}
              </strong>
              {c.disputed && <Badge variant="warning">{c.disputeResolved ? 'Dispute resolved' : 'Under review'}</Badge>}
            </div>
            <p className="meta">{c.reason}</p>
            {c.gates && c.verdict !== 'DEMONSTRATED' && (
              <p className="meta">Not fully demonstrated — required for the {data.level} badge.</p>
            )}
            {!c.disputed &&
              (disputeOpenFor === c.claimId ? (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    rows={3}
                    value={disputeBody}
                    onChange={(e) => setDisputeBody(e.target.value)}
                    placeholder="What's wrong, and what did you actually say?"
                  />
                  {disputeError && <p className="error">{disputeError}</p>}
                  <div className="row" style={{ margin: '8px 0 0' }}>
                    <button onClick={() => submitDispute(c.claimId)} disabled={disputeSubmitting}>
                      {disputeSubmitting ? 'Submitting…' : 'Submit dispute'}
                    </button>
                    <button
                      onClick={() => {
                        setDisputeOpenFor(null);
                        setDisputeError('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => {
                  setDisputeOpenFor(c.claimId);
                  setDisputeBody('');
                  setDisputeError('');
                }}>
                  Dispute this
                </button>
              ))}
          </div>
        ))}
      </div>

      {data.transcript && (
        <details
          className="hint-toggle"
          open={showTranscript}
          onToggle={(e) => setShowTranscript((e.target as HTMLDetailsElement).open)}
        >
          <summary>Full transcript ({data.transcript.length} turns)</summary>
          {data.transcript.map((t) => (
            <div
              key={t.id}
              className="transcript-turn"
              style={t.superseded ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
            >
              <div className="meta">{t.role}</div>
              <p style={{ margin: '4px 0 12px' }}>{t.content}</p>
            </div>
          ))}
        </details>
      )}

      <p style={{ marginTop: 16 }}>
        <Link href="/assessments">← Back to assessments</Link>
      </p>
    </main>
  );
}
