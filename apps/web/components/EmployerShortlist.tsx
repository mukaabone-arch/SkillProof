'use client';

/**
 * The org's shortlist — candidates collected from the applicants list, find-
 * candidates search, and match results (see ShortlistButton, used on all
 * three) — and, now that a candidate is shortlisted, the place to drive
 * them through the hiring pipeline: invite, run interview rounds, extend an
 * offer, and record the final outcome. See ShortlistStage's doc comment
 * (API side) and pipeline-transitions.ts for the full state machine this
 * UI is a thin front-end for — every action here maps 1:1 to one
 * transition, and the API is the source of truth (a stale/duplicate click
 * here just gets a 409, not a broken UI state).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { employerApi, downloadBlob } from '@/lib/api';
import { Badge } from '@/components/ui';
import CandidateAvatar from './CandidateAvatar';

const { api, apiBlob } = employerApi;

interface ShortlistSkill {
  skillId: string;
  skillName: string;
  level: string;
  verifiedBy: 'TEST' | 'DISCUSSION';
  verifyHash: string;
}

/** Display/filter only — mirrors the API's CandidateRoleTitle enum. Never fed into match scoring. */
type CandidateRoleTitle =
  | 'AI_ENGINEER'
  | 'ML_ENGINEER'
  | 'PROMPT_ENGINEER'
  | 'DATA_SCIENTIST'
  | 'MLOPS_ENGINEER'
  | 'NLP_ENGINEER'
  | 'COMPUTER_VISION_ENGINEER'
  | 'RESEARCH_ENGINEER'
  | 'DATA_ENGINEER'
  | 'AI_PRODUCT_MANAGER'
  | 'OTHER';

const ROLE_TITLE_LABELS: Record<CandidateRoleTitle, string> = {
  AI_ENGINEER: 'AI Engineer',
  ML_ENGINEER: 'ML Engineer',
  PROMPT_ENGINEER: 'Prompt Engineer',
  DATA_SCIENTIST: 'Data Scientist',
  MLOPS_ENGINEER: 'MLOps Engineer',
  NLP_ENGINEER: 'NLP Engineer',
  COMPUTER_VISION_ENGINEER: 'Computer Vision Engineer',
  RESEARCH_ENGINEER: 'Research Engineer',
  DATA_ENGINEER: 'Data Engineer',
  AI_PRODUCT_MANAGER: 'AI Product Manager',
  OTHER: 'Other',
};

type Stage = 'SHORTLISTED' | 'INVITED' | 'INTERVIEWING' | 'OFFER' | 'HIRED' | 'DECLINED' | 'REJECTED' | 'CLOSED';
type RoundStatus = 'SCHEDULED' | 'COMPLETED' | 'PASSED' | 'FAILED';
type CandidateResponse = 'ACCEPTED' | 'DECLINED' | 'NEGOTIATING';

interface InterviewRound {
  id: string;
  roundNumber: number;
  status: RoundStatus;
  channel: string | null;
  scheduledAt: string | null;
  note: string | null;
}

interface ShortlistEntry {
  id: string;
  candidateId: string;
  fullName: string | null;
  headline: string | null;
  roleTitle: CandidateRoleTitle | null;
  roleTitleOther: string | null;
  location: string | null;
  yearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  /** Bytes only ever fetched through the authenticated proxy endpoints — see CandidateAvatar and viewResume. */
  hasPhoto: boolean;
  hasResume: boolean;
  verifiedSkills: ShortlistSkill[];
  job: { id: string; title: string } | null;
  stage: Stage;
  note: string | null;
  inviteMessage: string | null;
  rejectReason: string | null;
  candidateResponse: CandidateResponse | null;
  rounds: InterviewRound[];
  createdAt: string;
}

const STAGE_LABELS: Record<Stage, string> = {
  SHORTLISTED: 'Shortlisted',
  INVITED: 'Invited — awaiting response',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer extended',
  HIRED: 'Hired',
  DECLINED: 'Candidate declined',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
};

const STAGE_BADGE_VARIANT: Record<Stage, 'default' | 'verified' | 'danger' | 'warning' | 'neutral'> = {
  SHORTLISTED: 'neutral',
  INVITED: 'default',
  INTERVIEWING: 'default',
  OFFER: 'warning',
  HIRED: 'verified',
  DECLINED: 'neutral',
  REJECTED: 'danger',
  CLOSED: 'neutral',
};

const STAGE_FILTERS: Stage[] = ['SHORTLISTED', 'INVITED', 'INTERVIEWING', 'OFFER', 'HIRED', 'DECLINED', 'REJECTED', 'CLOSED'];
const ROUND_STATUSES: RoundStatus[] = ['SCHEDULED', 'COMPLETED', 'PASSED', 'FAILED'];

function isValidStage(value: string | null): value is Stage {
  return !!value && (STAGE_FILTERS as string[]).includes(value);
}

interface Job {
  id: string;
  title: string;
}

/** Round `scheduledAt` comes back as an ISO string; datetime-local inputs need `YYYY-MM-DDTHH:mm`. */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EmployerShortlist() {
  // Dashboard cards link here as /employer/shortlist?stage=X[&jobId=Y] —
  // these seed the filters on first render so a card click lands already
  // filtered, not just on the unfiltered list.
  const searchParams = useSearchParams();
  const requestedStage = searchParams.get('stage');
  const requestedJobId = searchParams.get('jobId');

  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stageFilter, setStageFilter] = useState(isValidStage(requestedStage) ? requestedStage : '');
  const [jobFilter, setJobFilter] = useState(requestedJobId ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [resumeDownloadingId, setResumeDownloadingId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);

  const [inviteFormId, setInviteFormId] = useState<string | null>(null);
  const [inviteMessageDraft, setInviteMessageDraft] = useState('');

  const [rejectFormId, setRejectFormId] = useState<string | null>(null);
  const [rejectReasonDraft, setRejectReasonDraft] = useState('');

  const [addRoundFormId, setAddRoundFormId] = useState<string | null>(null);
  const [roundChannelDraft, setRoundChannelDraft] = useState('');
  const [roundScheduledAtDraft, setRoundScheduledAtDraft] = useState('');
  const [roundNoteDraft, setRoundNoteDraft] = useState('');

  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);
  const [editRoundStatus, setEditRoundStatus] = useState<RoundStatus>('SCHEDULED');
  const [editRoundChannel, setEditRoundChannel] = useState('');
  const [editRoundScheduledAt, setEditRoundScheduledAt] = useState('');
  const [editRoundNote, setEditRoundNote] = useState('');

  useEffect(() => {
    api<Job[]>('/jobs').then(setJobs).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageFilter, jobFilter]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (stageFilter) params.set('stage', stageFilter);
      if (jobFilter) params.set('jobId', jobFilter);
      const qs = params.toString();
      const res = await api<ShortlistEntry[]>(`/shortlist${qs ? `?${qs}` : ''}`);
      setEntries(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function replaceEntry(id: string, patch: Partial<ShortlistEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function remove(id: string) {
    if (!confirm('Remove this candidate from the shortlist?')) return;
    setRemovingId(id);
    setError('');
    try {
      await api(`/shortlist/${id}`, { method: 'DELETE' });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  /** Needs a jobId — resume access is checked against a specific job's applicant list (see GET /jobs/:jobId/applicants/:candidateId/resume), so an entry not tied to any job (general search-sourced) has no route to hit even if hasResume is true. */
  async function viewResume(jobId: string, candidateId: string) {
    setResumeDownloadingId(candidateId);
    setError('');
    try {
      const blob = await apiBlob(`/jobs/${jobId}/applicants/${candidateId}/resume`);
      downloadBlob(blob, 'resume.pdf');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResumeDownloadingId(null);
    }
  }

  function startEditNote(entry: ShortlistEntry) {
    setEditingNoteId(entry.id);
    setNoteDraft(entry.note ?? '');
  }

  async function saveNote(id: string) {
    setSavingNote(true);
    setError('');
    try {
      const updated = await api<ShortlistEntry>(`/shortlist/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ note: noteDraft.trim() || null }),
      });
      replaceEntry(id, { note: updated.note });
      setEditingNoteId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingNote(false);
    }
  }

  async function sendInvite(id: string) {
    setActionBusyKey(`invite-${id}`);
    setError('');
    try {
      await api(`/shortlist/${id}/invite`, {
        method: 'POST',
        body: JSON.stringify({ message: inviteMessageDraft.trim() || undefined }),
      });
      replaceEntry(id, { stage: 'INVITED', inviteMessage: inviteMessageDraft.trim() || null });
      setInviteFormId(null);
      setInviteMessageDraft('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyKey(null);
    }
  }

  async function extendOffer(id: string) {
    setActionBusyKey(`offer-${id}`);
    setError('');
    try {
      await api(`/shortlist/${id}/offer`, { method: 'POST' });
      replaceEntry(id, { stage: 'OFFER' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyKey(null);
    }
  }

  async function setOutcome(id: string, outcome: 'HIRED' | 'CLOSED') {
    if (!confirm(`Mark this candidate as ${outcome === 'HIRED' ? 'hired' : 'closed'}? This is the final pipeline outcome.`)) return;
    setActionBusyKey(`outcome-${id}`);
    setError('');
    try {
      await api(`/shortlist/${id}/outcome`, { method: 'POST', body: JSON.stringify({ outcome }) });
      replaceEntry(id, { stage: outcome });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyKey(null);
    }
  }

  async function sendReject(id: string) {
    setActionBusyKey(`reject-${id}`);
    setError('');
    try {
      await api(`/shortlist/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReasonDraft.trim() || undefined }),
      });
      replaceEntry(id, { stage: 'REJECTED', rejectReason: rejectReasonDraft.trim() || null });
      setRejectFormId(null);
      setRejectReasonDraft('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyKey(null);
    }
  }

  function startAddRound(id: string) {
    setAddRoundFormId(id);
    setRoundChannelDraft('');
    setRoundScheduledAtDraft('');
    setRoundNoteDraft('');
  }

  async function saveNewRound(id: string) {
    setActionBusyKey(`add-round-${id}`);
    setError('');
    try {
      const round = await api<InterviewRound>(`/shortlist/${id}/rounds`, {
        method: 'POST',
        body: JSON.stringify({
          channel: roundChannelDraft.trim() || undefined,
          scheduledAt: roundScheduledAtDraft ? new Date(roundScheduledAtDraft).toISOString() : undefined,
          note: roundNoteDraft.trim() || undefined,
        }),
      });
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, rounds: [...e.rounds, round] } : e)));
      setAddRoundFormId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyKey(null);
    }
  }

  function startEditRound(round: InterviewRound) {
    setEditingRoundId(round.id);
    setEditRoundStatus(round.status);
    setEditRoundChannel(round.channel ?? '');
    setEditRoundScheduledAt(toDatetimeLocal(round.scheduledAt));
    setEditRoundNote(round.note ?? '');
  }

  async function saveRoundEdit(entryId: string, roundId: string) {
    setActionBusyKey(`edit-round-${roundId}`);
    setError('');
    try {
      const updated = await api<InterviewRound>(`/shortlist/${entryId}/rounds/${roundId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: editRoundStatus,
          channel: editRoundChannel.trim() || undefined,
          scheduledAt: editRoundScheduledAt ? new Date(editRoundScheduledAt).toISOString() : undefined,
          note: editRoundNote.trim() || undefined,
        }),
      });
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, rounds: e.rounds.map((r) => (r.id === roundId ? updated : r)) } : e)),
      );
      setEditingRoundId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyKey(null);
    }
  }

  return (
    <main>
      <h1>Shortlist</h1>
      <p>Candidates you&apos;ve collected from applicants, search, and matches — and where you drive them through the hiring pipeline.</p>

      <div className="row" style={{ margin: 0, flexWrap: 'wrap' }}>
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="stageFilter">Stage</label>
          <select id="stageFilter" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">All stages</option>
            {STAGE_FILTERS.map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {jobs.length > 0 && (
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="jobFilter">Role</label>
            <select id="jobFilter" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
              <option value="">All roles</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="meta">Loading…</p>}

      {!loading && entries.length === 0 && (
        <p className="meta">
          Nothing here yet. Add candidates from a job&apos;s applicants or matches, or from{' '}
          <Link href="/employer">Find candidates</Link>.
        </p>
      )}

      {entries.map((e) => (
        <div key={e.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0, alignItems: 'flex-start' }}>
            <div className="row" style={{ margin: 0, alignItems: 'center' }}>
              <CandidateAvatar profileId={e.candidateId} fullName={e.fullName} hasPhoto={e.hasPhoto} size={44} />
              <div>
                <strong>{e.fullName || 'Candidate'}</strong>
                {e.roleTitle && (
                  <div className="meta" style={{ margin: 0 }}>
                    {e.roleTitle === 'OTHER' ? e.roleTitleOther || 'Other' : ROLE_TITLE_LABELS[e.roleTitle]}
                  </div>
                )}
              </div>
            </div>
            <div className="row" style={{ margin: 0 }}>
              <Badge variant={STAGE_BADGE_VARIANT[e.stage]}>{STAGE_LABELS[e.stage]}</Badge>
              <button className="btn-danger" onClick={() => remove(e.id)} disabled={removingId === e.id}>
                {removingId === e.id ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
          {e.headline && <div className="meta">{e.headline}</div>}
          <div className="meta">
            {e.location || 'Location not set'}
            {e.yearsOfExp !== null && ` · ${e.yearsOfExp} yrs experience`}
          </div>
          <div className="meta">
            {e.job ? `For: ${e.job.title}` : 'General shortlist (not tied to a job)'}
            {' · '}Added {new Date(e.createdAt).toLocaleDateString()}
          </div>

          {(e.githubUrl || e.linkedinUrl || (e.hasResume && e.job)) && (
            <div className="row" style={{ margin: 0, alignItems: 'center' }}>
              {e.githubUrl && <a href={e.githubUrl} target="_blank" rel="noopener noreferrer">GitHub</a>}
              {e.linkedinUrl && <a href={e.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
              {e.hasResume && e.job && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => viewResume(e.job!.id, e.candidateId)}
                  disabled={resumeDownloadingId === e.candidateId}
                >
                  {resumeDownloadingId === e.candidateId ? 'Downloading…' : 'View resume'}
                </button>
              )}
            </div>
          )}

          {e.verifiedSkills.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', margin: 0, marginTop: 4 }}>
              {e.verifiedSkills.map((s) => (
                <Link key={s.skillId} href={`/badges/${s.verifyHash}`}>
                  <Badge variant="verified" title={s.verifiedBy === 'DISCUSSION' ? 'Verified by discussion' : 'Verified by test'}>
                    {s.skillName} ({s.level}) {s.verifiedBy === 'DISCUSSION' ? '💬' : ''}
                  </Badge>
                </Link>
              ))}
            </div>
          )}

          {editingNoteId === e.id ? (
            <div className="field" style={{ marginTop: 4 }}>
              <label htmlFor={`note-${e.id}`}>Note</label>
              <textarea
                id={`note-${e.id}`}
                rows={3}
                value={noteDraft}
                onChange={(ev) => setNoteDraft(ev.target.value)}
                placeholder="Why this candidate, next steps, anything the hiring team should know…"
              />
              <div className="row" style={{ margin: 0 }}>
                <button onClick={() => saveNote(e.id)} disabled={savingNote}>
                  {savingNote ? 'Saving…' : 'Save note'}
                </button>
                <button className="btn-secondary" onClick={() => setEditingNoteId(null)} disabled={savingNote}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ alignItems: 'center', margin: 0, marginTop: 4 }}>
              {e.note ? <p style={{ margin: 0, flex: 1 }}>{e.note}</p> : <span className="meta" style={{ margin: 0, flex: 1 }}>No note</span>}
              <button className="btn-secondary" onClick={() => startEditNote(e)}>
                {e.note ? 'Edit note' : 'Add note'}
              </button>
            </div>
          )}

          {/* ---- Pipeline ---- */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--ink-12)' }}>
            {e.stage === 'SHORTLISTED' && (
              inviteFormId === e.id ? (
                <div className="field">
                  <label htmlFor={`invite-${e.id}`}>Invite message (optional)</label>
                  <textarea
                    id={`invite-${e.id}`}
                    rows={2}
                    value={inviteMessageDraft}
                    onChange={(ev) => setInviteMessageDraft(ev.target.value)}
                    placeholder="A short note the candidate will see with the invite…"
                  />
                  <div className="row" style={{ margin: 0 }}>
                    <button onClick={() => sendInvite(e.id)} disabled={actionBusyKey === `invite-${e.id}`}>
                      {actionBusyKey === `invite-${e.id}` ? 'Sending…' : 'Send invite'}
                    </button>
                    <button className="btn-secondary" onClick={() => setInviteFormId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setInviteFormId(e.id); setInviteMessageDraft(''); }}>Invite to interview</button>
              )
            )}

            {e.stage === 'INVITED' && (
              <p className="meta" style={{ margin: 0 }}>
                Waiting for the candidate to accept or decline{e.inviteMessage ? ` — sent: "${e.inviteMessage}"` : ''}.
              </p>
            )}

            {e.stage === 'INTERVIEWING' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="meta" style={{ margin: 0 }}>Interview rounds</div>
                {e.rounds.length === 0 && <p className="meta" style={{ margin: 0 }}>No rounds added yet.</p>}
                {e.rounds.map((r) => (
                  <div key={r.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                    {editingRoundId === r.id ? (
                      <>
                        <div className="field">
                          <label htmlFor={`round-status-${r.id}`}>Status</label>
                          <select
                            id={`round-status-${r.id}`}
                            value={editRoundStatus}
                            onChange={(ev) => setEditRoundStatus(ev.target.value as RoundStatus)}
                          >
                            {ROUND_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`round-channel-${r.id}`}>Channel</label>
                          <input
                            id={`round-channel-${r.id}`}
                            value={editRoundChannel}
                            onChange={(ev) => setEditRoundChannel(ev.target.value)}
                            placeholder="Zoom link, phone number, or “we’ll email you”"
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`round-time-${r.id}`}>Scheduled at</label>
                          <input
                            id={`round-time-${r.id}`}
                            type="datetime-local"
                            value={editRoundScheduledAt}
                            onChange={(ev) => setEditRoundScheduledAt(ev.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`round-note-${r.id}`}>Note (internal only)</label>
                          <textarea
                            id={`round-note-${r.id}`}
                            rows={2}
                            value={editRoundNote}
                            onChange={(ev) => setEditRoundNote(ev.target.value)}
                          />
                        </div>
                        <div className="row" style={{ margin: 0 }}>
                          <button onClick={() => saveRoundEdit(e.id, r.id)} disabled={actionBusyKey === `edit-round-${r.id}`}>
                            {actionBusyKey === `edit-round-${r.id}` ? 'Saving…' : 'Save round'}
                          </button>
                          <button className="btn-secondary" onClick={() => setEditingRoundId(null)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                          <strong>Round {r.roundNumber}</strong>
                          <Badge variant={r.status === 'PASSED' ? 'verified' : r.status === 'FAILED' ? 'danger' : 'default'}>
                            {r.status}
                          </Badge>
                        </div>
                        {r.channel && <div className="meta">{r.channel}</div>}
                        {r.scheduledAt && <div className="meta">{new Date(r.scheduledAt).toLocaleString()}</div>}
                        {r.note && <div className="meta">Note: {r.note}</div>}
                        <button className="btn-secondary" onClick={() => startEditRound(r)}>Edit round</button>
                      </>
                    )}
                  </div>
                ))}

                {addRoundFormId === e.id ? (
                  <div className="field">
                    <label htmlFor={`new-round-channel-${e.id}`}>Channel (optional)</label>
                    <input
                      id={`new-round-channel-${e.id}`}
                      value={roundChannelDraft}
                      onChange={(ev) => setRoundChannelDraft(ev.target.value)}
                      placeholder="Zoom link, phone number, or “we’ll email you”"
                    />
                    <label htmlFor={`new-round-time-${e.id}`}>Scheduled at (optional)</label>
                    <input
                      id={`new-round-time-${e.id}`}
                      type="datetime-local"
                      value={roundScheduledAtDraft}
                      onChange={(ev) => setRoundScheduledAtDraft(ev.target.value)}
                    />
                    <label htmlFor={`new-round-note-${e.id}`}>Note (internal only, optional)</label>
                    <textarea
                      id={`new-round-note-${e.id}`}
                      rows={2}
                      value={roundNoteDraft}
                      onChange={(ev) => setRoundNoteDraft(ev.target.value)}
                    />
                    <div className="row" style={{ margin: 0 }}>
                      <button onClick={() => saveNewRound(e.id)} disabled={actionBusyKey === `add-round-${e.id}`}>
                        {actionBusyKey === `add-round-${e.id}` ? 'Adding…' : 'Add round'}
                      </button>
                      <button className="btn-secondary" onClick={() => setAddRoundFormId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn-secondary" onClick={() => startAddRound(e.id)}>+ Add round</button>
                )}

                <button onClick={() => extendOffer(e.id)} disabled={actionBusyKey === `offer-${e.id}`}>
                  {actionBusyKey === `offer-${e.id}` ? 'Extending…' : 'Extend offer'}
                </button>
              </div>
            )}

            {e.stage === 'OFFER' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p className="meta" style={{ margin: 0 }}>
                  Candidate response: {e.candidateResponse ? e.candidateResponse : 'No response yet'}
                </p>
                <div className="row" style={{ margin: 0 }}>
                  <button onClick={() => setOutcome(e.id, 'HIRED')} disabled={actionBusyKey === `outcome-${e.id}`}>
                    Mark hired
                  </button>
                  <button className="btn-secondary" onClick={() => setOutcome(e.id, 'CLOSED')} disabled={actionBusyKey === `outcome-${e.id}`}>
                    Close (no hire)
                  </button>
                </div>
              </div>
            )}

            {(e.stage === 'HIRED' || e.stage === 'CLOSED') && e.candidateResponse && (
              <p className="meta" style={{ margin: 0 }}>Candidate response was: {e.candidateResponse}</p>
            )}

            {e.stage === 'REJECTED' && e.rejectReason && (
              <p className="meta" style={{ margin: 0 }}>Reason: {e.rejectReason}</p>
            )}

            {['SHORTLISTED', 'INVITED', 'INTERVIEWING', 'OFFER'].includes(e.stage) && (
              rejectFormId === e.id ? (
                <div className="field" style={{ marginTop: 8 }}>
                  <label htmlFor={`reject-${e.id}`}>Reason (optional, internal only)</label>
                  <textarea
                    id={`reject-${e.id}`}
                    rows={2}
                    value={rejectReasonDraft}
                    onChange={(ev) => setRejectReasonDraft(ev.target.value)}
                  />
                  <div className="row" style={{ margin: 0 }}>
                    <button className="btn-danger" onClick={() => sendReject(e.id)} disabled={actionBusyKey === `reject-${e.id}`}>
                      {actionBusyKey === `reject-${e.id}` ? 'Rejecting…' : 'Confirm reject'}
                    </button>
                    <button className="btn-secondary" onClick={() => setRejectFormId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn-danger"
                  style={{ marginTop: 8 }}
                  onClick={() => { setRejectFormId(e.id); setRejectReasonDraft(''); }}
                >
                  Reject
                </button>
              )
            )}
          </div>
        </div>
      ))}
    </main>
  );
}
