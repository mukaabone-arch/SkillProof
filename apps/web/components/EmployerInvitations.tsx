'use client';

/**
 * Employer-triggered assessment invitations, shown at the top of the
 * candidate /assessments page — this is the free-to-the-candidate,
 * employer-paid counterpart to the self-serve catalog below it. Only
 * renders when there's something to show (returns null otherwise), so a
 * candidate who's never been requested sees no change to the page at all.
 *
 * Whole-skill (2026-09-14 rework): most invitations now cover all three
 * levels of a skill (`level: null` on the request, a `levels` array
 * instead) — the candidate picks which one to start, in any order, and
 * can keep coming back to start another after finishing one. A legacy
 * (`level` set) invitation — frozen shape from before the rework — still
 * has exactly one level and one Start action, unchanged.
 *
 * Starting a level calls POST /assessment-requests/mine/:id/start with
 * { level }, then routes straight into the *existing* take-flow pages using
 * the assessmentId/sessionId that returns — /assessments/[assessmentId]
 * (MCQ) or /assessments/discussion/session/[sessionId] (discussion). No new
 * take-flow UI needed; see AssessmentRequestsService.launchLinkedAssessment's
 * own doc comment for why that's safe (the MCQ page's own start call is
 * idempotent and just resumes the attempt this already created).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type RequestStatus =
  | 'ACCRUED_PENDING_START'
  | 'STARTED'
  | 'COMPLETED'
  | 'EXPIRED_UNBILLED'
  | 'ALREADY_BADGED';

/** One level's progress within a whole-skill invitation — present only when the parent's `level` is null. */
interface LevelProgressView {
  level: string;
  attemptId: string | null;
  sessionId: string | null;
  alreadyBadged: boolean;
}

interface InvitationView {
  id: string;
  /** Null for a whole-skill invitation (2026-09-14 rework) — see `levels` below. Set only on a legacy invitation that predates the rework. */
  level: string | null;
  status: RequestStatus;
  expiresAt: string | null;
  skill: { name: string };
  organization: { name: string };
  /** Whole-skill only — one entry per level the skill offers. */
  levels?: LevelProgressView[];
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
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<InvitationView[]>('/assessment-requests/mine')
      .then(setInvitations)
      .catch(() => setInvitations([]));
  }, []);

  async function start(id: string, level: string) {
    const key = `${id}|${level}`;
    setError('');
    setStartingKey(key);
    try {
      const result = await api<StartResponse>(`/assessment-requests/mine/${id}/start`, {
        method: 'POST',
        body: JSON.stringify({ level }),
      });
      if (result.assessmentId) {
        router.push(`/assessments/${result.assessmentId}`);
      } else if (result.sessionId) {
        router.push(`/assessments/discussion/session/${result.sessionId}`);
      } else {
        setError('Could not start this assessment — please try again.');
        setStartingKey(null);
      }
    } catch (e) {
      setError((e as Error).message);
      setStartingKey(null);
    }
  }

  if (!invitations) return null;
  // Legacy: unchanged — once started, there's nothing left to start for a
  // single-level invitation. Whole-skill: stays actionable through STARTED
  // too, since other levels may still be open even once one has begun.
  const pending = invitations.filter((i) =>
    i.level !== null ? i.status === 'ACCRUED_PENDING_START' : i.status === 'ACCRUED_PENDING_START' || i.status === 'STARTED',
  );
  if (pending.length === 0) return null;

  return (
    <div className="ui-card" style={{ marginBottom: 24, borderColor: 'var(--indigo)' }}>
      <span className="eyebrow">Employer request{pending.length === 1 ? '' : 's'}</span>
      <h2 style={{ marginTop: 8, marginBottom: 4 }}>
        {pending.length === 1 ? "You've been invited to an assessment" : `You've been invited to ${pending.length} assessments`}
      </h2>
      <p style={{ marginBottom: 8 }}>
        Free to you — an employer paid to verify this skill on your profile. The badges are yours either way, and
        employers can see them independently of who requested it.
      </p>
      {/*
        Disclosure, not just courtesy copy — the candidate needs to know
        this before starting, not after. Worded to be true for both formats
        at once (a skills test gets a score/topic breakdown, a
        conversational assessment only ever gets pass/fail) rather than
        branching per-invitation, since this intro sits above the whole
        list and could cover a mix of both. See
        AssessmentRequestsService.notifyCandidateInvited for the
        per-format-precise wording sent in the invite email itself.
      */}
      <p style={{ marginBottom: 16 }} className="meta">
        When you finish a level, the requesting employer will see your result for that level — whether you passed,
        and for a skills test, your score and how you performed by topic. They won&apos;t see your individual
        answers, the questions, or (for a conversation-based assessment) the conversation itself.
      </p>
      {pending.map((inv) =>
        inv.level !== null ? (
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
            <button onClick={() => start(inv.id, inv.level!)} disabled={startingKey === `${inv.id}|${inv.level}`}>
              {startingKey === `${inv.id}|${inv.level}` ? 'Starting…' : 'Start now'}
            </button>
          </div>
        ) : (
          <div key={inv.id} style={{ marginBottom: 12 }}>
            <strong>{inv.skill.name} — all three levels</strong>
            <div className="meta" style={{ marginBottom: 6 }}>
              Requested by {inv.organization.name}
              {inv.expiresAt && inv.status === 'ACCRUED_PENDING_START' ? ` · start one within ${daysLeft(inv.expiresAt)}` : ''}
            </div>
            {(inv.levels ?? []).map((lvl) => {
              const key = `${inv.id}|${lvl.level}`;
              const inProgress = !!(lvl.attemptId || lvl.sessionId);
              return (
                <div key={lvl.level} className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>Level {lvl.level}</span>
                  {lvl.alreadyBadged ? (
                    <span className="ui-badge ui-badge-verified">Already verified</span>
                  ) : (
                    <button onClick={() => start(inv.id, lvl.level)} disabled={startingKey === key}>
                      {startingKey === key ? 'Starting…' : inProgress ? 'Resume' : 'Start now'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ),
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
