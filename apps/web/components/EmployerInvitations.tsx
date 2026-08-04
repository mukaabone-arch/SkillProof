'use client';

/**
 * Employer-triggered assessment invitations, shown at the top of the
 * candidate /assessments page — this is the free-to-the-candidate,
 * employer-paid counterpart to the self-serve catalog below it. Only
 * renders when there's something to show (returns null otherwise), so a
 * candidate who's never been requested sees no change to the page at all.
 *
 * Starting one calls POST /assessment-requests/mine/:id/start, then routes
 * straight into the *existing* take-flow pages using the assessmentId/
 * sessionId that returns — /assessments/[assessmentId] (MCQ) or
 * /assessments/discussion/session/[sessionId] (discussion). No new
 * take-flow UI needed; see AssessmentRequestsService.launchLinkedAssessment's
 * own doc comment for why that's safe (the MCQ page's own start call is
 * idempotent and just resumes the attempt this already created).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type RequestStatus =
  | 'PAID_PENDING_START'
  | 'STARTED'
  | 'COMPLETED'
  | 'EXPIRED_REFUNDED'
  | 'REFUND_FAILED'
  | 'ALREADY_BADGED';

interface InvitationView {
  id: string;
  level: string;
  status: RequestStatus;
  expiresAt: string | null;
  skill: { name: string };
  organization: { name: string };
}

interface StartResponse {
  attemptId: string | null;
  sessionId: string | null;
  assessmentId: string | null;
}

function daysLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  return days <= 1 ? 'less than a day left' : `${days} days left`;
}

export default function EmployerInvitations() {
  const router = useRouter();
  const [invitations, setInvitations] = useState<InvitationView[] | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<InvitationView[]>('/assessment-requests/mine')
      .then(setInvitations)
      .catch(() => setInvitations([]));
  }, []);

  async function start(id: string) {
    setError('');
    setStartingId(id);
    try {
      const result = await api<StartResponse>(`/assessment-requests/mine/${id}/start`, { method: 'POST' });
      if (result.assessmentId) {
        router.push(`/assessments/${result.assessmentId}`);
      } else if (result.sessionId) {
        router.push(`/assessments/discussion/session/${result.sessionId}`);
      } else {
        setError('Could not start this assessment — please try again.');
        setStartingId(null);
      }
    } catch (e) {
      setError((e as Error).message);
      setStartingId(null);
    }
  }

  if (!invitations) return null;
  const pending = invitations.filter((i) => i.status === 'PAID_PENDING_START');
  if (pending.length === 0) return null;

  return (
    <div className="ui-card" style={{ marginBottom: 24, borderColor: 'var(--indigo)' }}>
      <span className="eyebrow">Employer request{pending.length === 1 ? '' : 's'}</span>
      <h2 style={{ marginTop: 8, marginBottom: 4 }}>
        {pending.length === 1 ? "You've been invited to an assessment" : `You've been invited to ${pending.length} assessments`}
      </h2>
      <p style={{ marginBottom: 16 }}>
        Free to you — an employer paid to verify this skill on your profile. The badge is yours either way, and
        employers can see it independently of who requested it.
      </p>
      {pending.map((inv) => (
        <div key={inv.id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong>
              {inv.skill.name} — Level {inv.level}
            </strong>
            <div className="meta">
              Requested by {inv.organization.name}
              {inv.expiresAt ? ` · ${daysLeft(inv.expiresAt)}` : ''}
            </div>
          </div>
          <button onClick={() => start(inv.id)} disabled={startingId === inv.id}>
            {startingId === inv.id ? 'Starting…' : 'Start now'}
          </button>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
