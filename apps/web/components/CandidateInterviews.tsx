'use client';

/**
 * The candidate's own view of every pipeline they're in, across every
 * employer — where they stand, what to do next, and how to attend the
 * current round. Deliberately calmer/sparser than the employer's
 * EmployerShortlist: no round history (just the current one), no note
 * fields (those are employer-only, and the API never sends them here — see
 * InterviewsService.present on the API side), no total round count (an
 * employer never commits to a number upfront).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Stage = 'SHORTLISTED' | 'INVITED' | 'INTERVIEWING' | 'OFFER' | 'HIRED' | 'DECLINED' | 'REJECTED' | 'CLOSED';
type RoundStatus = 'SCHEDULED' | 'COMPLETED' | 'PASSED' | 'FAILED';
type CandidateResponse = 'ACCEPTED' | 'DECLINED' | 'NEGOTIATING';

interface CurrentRound {
  roundNumber: number;
  status: RoundStatus;
  channel: string | null;
  scheduledAt: string | null;
}

interface Interview {
  id: string;
  orgName: string;
  job: { id: string; title: string } | null;
  stage: Stage;
  inviteMessage: string | null;
  currentRound: CurrentRound | null;
  candidateResponse: CandidateResponse | null;
  updatedAt: string;
}

const STAGE_LABELS: Record<Stage, string> = {
  SHORTLISTED: 'On their shortlist',
  INVITED: 'Invited to interview',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer extended',
  HIRED: 'Hired',
  DECLINED: "You declined",
  REJECTED: 'Not moving forward',
  CLOSED: 'Closed',
};

const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  PASSED: 'Passed',
  FAILED: 'Did not pass',
};

export default function CandidateInterviews() {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setInterviews(await api<Interview[]>('/interviews/mine'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function replace(id: string, patch: Partial<Interview>) {
    setInterviews((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function respondInvite(id: string, response: 'ACCEPT' | 'DECLINE') {
    if (response === 'DECLINE' && !confirm('Decline this interview invite? This ends the pipeline with this employer.')) return;
    setActionBusyId(id);
    setError('');
    try {
      await api(`/interviews/${id}/respond-invite`, { method: 'POST', body: JSON.stringify({ response }) });
      replace(id, { stage: response === 'ACCEPT' ? 'INTERVIEWING' : 'DECLINED' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  }

  async function respondOffer(id: string, response: CandidateResponse) {
    setActionBusyId(id);
    setError('');
    try {
      await api(`/interviews/${id}/respond-offer`, { method: 'POST', body: JSON.stringify({ response }) });
      replace(id, { candidateResponse: response });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  }

  return (
    <>
      {loading && <p className="meta">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && interviews.length === 0 && (
        <p>
          No active interview pipelines yet. When an employer invites you after shortlisting you, it&apos;ll show up here.
        </p>
      )}

      {interviews.map((i) => (
        <div key={i.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <strong>{i.orgName}</strong>
            <span className="meta">{STAGE_LABELS[i.stage]}</span>
          </div>
          {i.job && <div className="meta">{i.job.title}</div>}

          {i.stage === 'INVITED' && (
            <div style={{ marginTop: 4 }}>
              {i.inviteMessage && <p style={{ margin: '0 0 8px' }}>&ldquo;{i.inviteMessage}&rdquo;</p>}
              <div className="row" style={{ margin: 0 }}>
                <button onClick={() => respondInvite(i.id, 'ACCEPT')} disabled={actionBusyId === i.id}>
                  {actionBusyId === i.id ? 'Saving…' : 'Accept'}
                </button>
                <button className="btn-secondary" onClick={() => respondInvite(i.id, 'DECLINE')} disabled={actionBusyId === i.id}>
                  Decline
                </button>
              </div>
            </div>
          )}

          {i.stage === 'INTERVIEWING' && (
            <div style={{ marginTop: 4 }}>
              {i.currentRound ? (
                <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                  <strong>Round {i.currentRound.roundNumber}</strong>
                  <span className="meta">{ROUND_STATUS_LABELS[i.currentRound.status]}</span>
                  {i.currentRound.channel && <div className="meta">How to attend: {i.currentRound.channel}</div>}
                  {i.currentRound.scheduledAt && (
                    <div className="meta">{new Date(i.currentRound.scheduledAt).toLocaleString()}</div>
                  )}
                </div>
              ) : (
                <p className="meta" style={{ margin: 0 }}>You&apos;re in — the employer will schedule your first round soon.</p>
              )}
            </div>
          )}

          {i.stage === 'OFFER' && (
            <div style={{ marginTop: 4 }}>
              {i.candidateResponse ? (
                <p className="meta" style={{ margin: 0 }}>Your response: {i.candidateResponse}</p>
              ) : (
                <>
                  <p style={{ margin: '0 0 8px' }}>You&apos;ve received an offer. Let them know where you stand:</p>
                  <div className="row" style={{ margin: 0 }}>
                    <button onClick={() => respondOffer(i.id, 'ACCEPTED')} disabled={actionBusyId === i.id}>Accept</button>
                    <button className="btn-secondary" onClick={() => respondOffer(i.id, 'NEGOTIATING')} disabled={actionBusyId === i.id}>
                      Still deciding
                    </button>
                    <button className="btn-secondary" onClick={() => respondOffer(i.id, 'DECLINED')} disabled={actionBusyId === i.id}>
                      Decline
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {(i.stage === 'HIRED' || i.stage === 'CLOSED') && i.candidateResponse && (
            <p className="meta" style={{ margin: 0 }}>Your response was: {i.candidateResponse}</p>
          )}
        </div>
      ))}
    </>
  );
}
