'use client';

/**
 * Job posting: create form with a "Paste JD → Parse with AI" step that
 * pre-fills title/experience and suggests taxonomy skills, plus a list of
 * the org's existing jobs. Nothing is auto-saved — the employer reviews the
 * AI suggestions before "Save job" ever calls the API.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import { Badge } from '@/components/ui';
import ShortlistButton from './ShortlistButton';

const { api } = employerApi;

interface Skill {
  id: string;
  name: string;
}

interface Domain {
  id: string;
  name: string;
  skills: Skill[];
}

interface JobSkillView {
  id: string;
  requiredLevel: string;
  isRequired: boolean;
  skill: { id: string; name: string };
}

type JobStatus = 'DRAFT' | 'LIVE' | 'CLOSED';

interface Job {
  id: string;
  title: string;
  description: string;
  employmentType: string;
  location: string | null;
  remote: boolean;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: JobStatus;
  skills: JobSkillView[];
}

/** GET /jobs already returns every scalar Job column (no `select`, only `include: { skills }`) — description/salary were just never read by the frontend before Edit needed to prefill a form with them. */

const JOB_STATUS_BADGE: Record<JobStatus, { label: string; variant: 'default' | 'verified' | 'neutral' }> = {
  DRAFT: { label: 'Draft', variant: 'default' },
  LIVE: { label: 'Live', variant: 'verified' },
  CLOSED: { label: 'Closed', variant: 'neutral' },
};

interface JobExtraction {
  title: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  suggestedSkills: { skillName: string; requiredLevel: string; isRequired: boolean }[];
}

interface SuggestedSkill {
  skillId: string;
  skillName: string;
  requiredLevel: string;
  isRequired: boolean;
}

interface JobForm {
  title: string;
  description: string;
  employmentType: string;
  location: string;
  remote: boolean;
  experienceMin: string;
  experienceMax: string;
  salaryMin: string;
  salaryMax: string;
  status: string;
}

interface MatchedSkill {
  skillId: string;
  skillName: string;
  level: string;
  verifiedBy: 'TEST' | 'DISCUSSION';
  verifyHash: string;
}

interface MissingSkill {
  skillId: string;
  skillName: string;
  requiredLevel: string;
  candidateLevel: string | null;
  verified: boolean;
}

interface CandidateMatch {
  profileId: string;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  score: number;
  matched: MatchedSkill[];
  missing: MissingSkill[];
  aiExplanation: string;
}

interface MatchesResponse {
  jobId: string;
  jobTitle: string;
  candidates: CandidateMatch[];
}

interface ApplicantSkill {
  skillId: string;
  skillName: string;
  level: string;
  verifiedBy: 'TEST' | 'DISCUSSION';
  verifyHash: string;
}

type CredentialIssuer = 'CREDLY' | 'AWS' | 'GOOGLE' | 'AZURE' | 'NVIDIA' | 'DATABRICKS' | 'IBM' | 'OTHER';
type NameMatchState = 'MATCH' | 'MISMATCH' | 'UNCHECKED';

interface ApplicantExternalCredential {
  id: string;
  issuer: CredentialIssuer;
  name: string | null;
  credentialUrl: string;
  issuedAt: string | null;
  expiresAt: string | null;
  /** Advisory only — see NameMatchState. Never affects verification or scoring. */
  nameMatchState: NameMatchState;
}

const ISSUER_LABELS: Record<CredentialIssuer, string> = {
  CREDLY: 'Credly',
  AWS: 'AWS',
  GOOGLE: 'Google',
  AZURE: 'Microsoft Azure',
  NVIDIA: 'NVIDIA',
  DATABRICKS: 'Databricks',
  IBM: 'IBM',
  OTHER: 'Unknown issuer',
};

interface Applicant {
  applicationId: string;
  status: string;
  appliedAt: string;
  profileId: string;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  /** True for applications that predate the apply-time profile requirement. */
  profileIncomplete: boolean;
  score: number | null;
  verifiedSkills: ApplicantSkill[];
  /** Only ever VERIFIED, non-scoring credentials — see JobsService.getApplicants. */
  externalCredentials: ApplicantExternalCredential[];
}

/** Only the fields needed to build the "already shortlisted" lookup — see ShortlistScreen for the full shape. */
interface ShortlistEntrySummary {
  id: string;
  candidateId: string;
}

const STATUS_ACTIONS = ['REVIEWED', 'SHORTLISTED', 'REJECTED'];

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'];
const LEVELS = ['L1', 'L2', 'L3', 'L4'];

const emptyForm: JobForm = {
  title: '',
  description: '',
  employmentType: 'FULL_TIME',
  location: '',
  remote: false,
  experienceMin: '',
  experienceMax: '',
  salaryMin: '',
  salaryMax: '',
  status: 'DRAFT',
};

export default function EmployerJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [skillIdByName, setSkillIdByName] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [form, setForm] = useState<JobForm>(emptyForm);
  const [suggested, setSuggested] = useState<SuggestedSkill[]>([]);
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);

  const [statusUpdatingJobId, setStatusUpdatingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  const [matchesForJob, setMatchesForJob] = useState<string | null>(null);
  const [matches, setMatches] = useState<CandidateMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchesError, setMatchesError] = useState('');
  // candidateId -> shortlist entry id, scoped to the job whose matches panel
  // is currently open — refetched fresh each time the panel opens, same as
  // `matches` itself (no cross-open caching, matching viewMatches' pattern).
  const [matchesShortlist, setMatchesShortlist] = useState<Record<string, string>>({});

  const [applicantsForJob, setApplicantsForJob] = useState<string | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loadingApplicants, setLoadingApplicants] = useState(false);
  const [applicantsError, setApplicantsError] = useState('');
  const [applicantsShortlist, setApplicantsShortlist] = useState<Record<string, string>>({});
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [statusConfirmed, setStatusConfirmed] = useState<string | null>(null);

  useEffect(() => {
    api<Job[]>('/jobs').then(setJobs).catch((e) => setError(e.message));
    api<Domain[]>('/taxonomy')
      .then((domains) => {
        const map: Record<string, string> = {};
        domains.forEach((d) => d.skills.forEach((s) => { map[s.name] = s.id; }));
        setSkillIdByName(map);
      })
      .catch(() =>
        setError(
          'Could not load the skills taxonomy — AI-suggested skills may not attach to new jobs. Refresh the page and try again.',
        ),
      );
  }, []);

  async function refresh() {
    setJobs(await api<Job[]>('/jobs'));
  }

  function openForm() {
    setEditingJobId(null);
    setShowForm(true);
    setForm(emptyForm);
    setSuggested([]);
    setError('');
  }

  /** Draft-only entry point (see the card's action row) — prefills the same form used to create a job, but saveJob() PATCHes instead of POSTs once editingJobId is set. */
  function openEditForm(job: Job) {
    setEditingJobId(job.id);
    setForm({
      title: job.title,
      description: job.description,
      employmentType: job.employmentType,
      location: job.location ?? '',
      remote: job.remote,
      experienceMin: job.experienceMin !== null ? String(job.experienceMin) : '',
      experienceMax: job.experienceMax !== null ? String(job.experienceMax) : '',
      salaryMin: job.salaryMin !== null ? String(job.salaryMin) : '',
      salaryMax: job.salaryMax !== null ? String(job.salaryMax) : '',
      status: job.status,
    });
    setSuggested([]);
    setShowForm(true);
    setError('');
  }

  /** Post job (DRAFT→LIVE), Unpublish (LIVE→CLOSED), and Reopen (CLOSED→LIVE) all go through the same generic PATCH /jobs/:id the create form's status dropdown already uses — there's no dedicated publish endpoint, and none is needed since this one has no transition restrictions. */
  async function setJobStatus(jobId: string, status: JobStatus) {
    setStatusUpdatingJobId(jobId);
    setError('');
    try {
      await api(`/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status } : j)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatusUpdatingJobId(null);
    }
  }

  /** Draft-only — the backend rejects this for LIVE/CLOSED jobs (see JobsService.remove); a live job's history is closed, not deleted. */
  async function deleteDraft(jobId: string) {
    if (!confirm('Delete this draft job? This cannot be undone.')) return;
    setDeletingJobId(jobId);
    setError('');
    try {
      await api(`/jobs/${jobId}`, { method: 'DELETE' });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingJobId(null);
    }
  }

  async function parseWithAi() {
    if (!form.description.trim()) {
      setError('Paste a job description first.');
      return;
    }
    setParsing(true);
    setError('');
    try {
      const result = await api<JobExtraction>('/jobs/parse-description', {
        method: 'POST',
        body: JSON.stringify({ description: form.description }),
      });

      setForm((f) => ({
        ...f,
        title: result.title ?? f.title,
        experienceMin:
          result.experienceMin !== null ? String(result.experienceMin) : f.experienceMin,
        experienceMax:
          result.experienceMax !== null ? String(result.experienceMax) : f.experienceMax,
      }));

      const mapped = result.suggestedSkills
        .filter((s) => skillIdByName[s.skillName])
        .map((s) => ({
          skillId: skillIdByName[s.skillName],
          skillName: s.skillName,
          requiredLevel: s.requiredLevel,
          isRequired: s.isRequired,
        }));
      setSuggested(mapped);

      if (result.suggestedSkills.length > 0 && mapped.length === 0) {
        setError(
          'The AI suggested skills, but none could be matched to the taxonomy — the skills ' +
            'taxonomy may still be loading. Try "Parse with AI" again before saving.',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function updateSuggested(index: number, patch: Partial<SuggestedSkill>) {
    setSuggested((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSuggested(index: number) {
    setSuggested((prev) => prev.filter((_, i) => i !== index));
  }

  async function loadShortlistForJob(jobId: string): Promise<Record<string, string>> {
    const entries = await api<ShortlistEntrySummary[]>(`/shortlist?jobId=${jobId}`);
    const map: Record<string, string> = {};
    entries.forEach((e) => { map[e.candidateId] = e.id; });
    return map;
  }

  async function viewMatches(jobId: string) {
    if (matchesForJob === jobId) {
      setMatchesForJob(null);
      return;
    }
    setMatchesForJob(jobId);
    setMatches([]);
    setMatchesShortlist({});
    setMatchesError('');
    setLoadingMatches(true);
    try {
      const [res, shortlist] = await Promise.all([
        api<MatchesResponse>(`/jobs/${jobId}/matches`),
        loadShortlistForJob(jobId),
      ]);
      setMatches(res.candidates);
      setMatchesShortlist(shortlist);
    } catch (e) {
      setMatchesError((e as Error).message);
    } finally {
      setLoadingMatches(false);
    }
  }

  async function viewApplicants(jobId: string) {
    if (applicantsForJob === jobId) {
      setApplicantsForJob(null);
      return;
    }
    setApplicantsForJob(jobId);
    setApplicants([]);
    setApplicantsShortlist({});
    setApplicantsError('');
    setLoadingApplicants(true);
    try {
      const [res, shortlist] = await Promise.all([
        api<Applicant[]>(`/jobs/${jobId}/applicants`),
        loadShortlistForJob(jobId),
      ]);
      setApplicants(res);
      setApplicantsShortlist(shortlist);
    } catch (e) {
      setApplicantsError((e as Error).message);
    } finally {
      setLoadingApplicants(false);
    }
  }

  async function updateApplicantStatus(applicationId: string, status: string) {
    setStatusUpdating(applicationId);
    setApplicantsError('');
    try {
      const updated = await api<{ status: string }>(`/applications/${applicationId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setApplicants((prev) =>
        prev.map((a) => (a.applicationId === applicationId ? { ...a, status: updated.status } : a)),
      );
      setStatusConfirmed(applicationId);
      setTimeout(() => setStatusConfirmed((c) => (c === applicationId ? null : c)), 2500);
    } catch (e) {
      setApplicantsError((e as Error).message);
    } finally {
      setStatusUpdating(null);
    }
  }

  async function saveJob() {
    if (!form.title.trim() || !form.description.trim()) {
      setError('Title and description are required.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        employmentType: form.employmentType,
        location: form.location || undefined,
        remote: form.remote,
        status: form.status,
      };
      if (form.experienceMin !== '') body.experienceMin = Number(form.experienceMin);
      if (form.experienceMax !== '') body.experienceMax = Number(form.experienceMax);
      if (form.salaryMin !== '') body.salaryMin = Number(form.salaryMin);
      if (form.salaryMax !== '') body.salaryMax = Number(form.salaryMax);

      const jobId = editingJobId
        ? (await api<{ id: string }>(`/jobs/${editingJobId}`, { method: 'PATCH', body: JSON.stringify(body) })).id
        : (await api<{ id: string }>('/jobs', { method: 'POST', body: JSON.stringify(body) })).id;

      if (suggested.length > 0) {
        await api(`/jobs/${jobId}/skills`, {
          method: 'POST',
          body: JSON.stringify({
            skills: suggested.map((s) => ({
              skillId: s.skillId,
              requiredLevel: s.requiredLevel,
              isRequired: s.isRequired,
            })),
          }),
        });
      }

      setShowForm(false);
      setEditingJobId(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
        <h2 style={{ margin: 0 }}>{showForm && editingJobId ? 'Edit draft' : 'Post a job'}</h2>
        {!showForm && <button onClick={openForm}>+ New job</button>}
      </div>

      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

      {showForm && (
        <div
          className="card"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, marginTop: 16 }}
        >
          <div className="field">
            <label htmlFor="jobDescription">Job description</label>
            <textarea
              id="jobDescription"
              rows={8}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Paste the full job description here…"
            />
          </div>
          <button onClick={parseWithAi} disabled={parsing || !form.description.trim()}>
            {parsing ? 'Parsing…' : 'Parse with AI'}
          </button>

          <div className="field">
            <label htmlFor="jobTitle">Title</label>
            <input
              id="jobTitle"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={160}
            />
          </div>

          <div className="field">
            <label htmlFor="employmentType">Employment type</label>
            <select
              id="employmentType"
              value={form.employmentType}
              onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace('_', ' ')}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="location">Location</label>
            <input
              id="location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              maxLength={160}
            />
          </div>

          <label className="row" style={{ alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.remote}
              onChange={(e) => setForm({ ...form, remote: e.target.checked })}
            />
            Remote
          </label>

          <div className="field">
            <label htmlFor="experienceMin">Experience (years)</label>
            <div className="row" style={{ margin: 0 }}>
              <input
                id="experienceMin"
                type="number"
                min={0}
                max={50}
                placeholder="Min"
                value={form.experienceMin}
                onChange={(e) => setForm({ ...form, experienceMin: e.target.value })}
              />
              <input
                type="number"
                min={0}
                max={50}
                placeholder="Max"
                value={form.experienceMax}
                onChange={(e) => setForm({ ...form, experienceMax: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="salaryMin">Salary range (optional)</label>
            <div className="row" style={{ margin: 0 }}>
              <input
                id="salaryMin"
                type="number"
                min={0}
                placeholder="Min"
                value={form.salaryMin}
                onChange={(e) => setForm({ ...form, salaryMin: e.target.value })}
              />
              <input
                type="number"
                min={0}
                placeholder="Max"
                value={form.salaryMax}
                onChange={(e) => setForm({ ...form, salaryMax: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="status">Status</label>
            <select
              id="status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="DRAFT">Draft</option>
              <option value="LIVE">Live</option>
            </select>
          </div>

          {suggested.length > 0 && (
            <div className="field">
              <label>AI-suggested skills — review before saving</label>
              {suggested.map((s, i) => (
                <div key={s.skillId} className="row" style={{ alignItems: 'center' }}>
                  <span style={{ flex: 1 }}>{s.skillName}</span>
                  <select
                    value={s.requiredLevel}
                    onChange={(e) => updateSuggested(i, { requiredLevel: e.target.value })}
                  >
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={s.isRequired}
                      onChange={(e) => updateSuggested(i, { isRequired: e.target.checked })}
                    />
                    Required
                  </label>
                  <button onClick={() => removeSuggested(i)}>Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ margin: 0 }}>
            <button onClick={saveJob} disabled={creating}>
              {creating ? 'Saving…' : editingJobId ? 'Save changes' : 'Save job'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingJobId(null); }}
              disabled={creating}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 32, marginBottom: 16 }}>Your jobs</h2>
      {jobs.length === 0 && <p>No jobs posted yet.</p>}
      {jobs.map((j) => (
        <div key={j.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <strong>{j.title}</strong>
            <Badge variant={JOB_STATUS_BADGE[j.status].variant}>{JOB_STATUS_BADGE[j.status].label}</Badge>
          </div>
          <div className="meta">
            {j.employmentType.replace('_', ' ')} · {j.remote ? 'Remote' : j.location || 'Location not set'}
            {(j.experienceMin !== null || j.experienceMax !== null) &&
              ` · ${j.experienceMin ?? 0}–${j.experienceMax ?? '∞'} yrs`}
          </div>
          {j.skills.length > 0 && (
            <div className="meta">
              Skills:{' '}
              {j.skills
                .map((s) => `${s.skill.name} (${s.requiredLevel}${s.isRequired ? '' : ', optional'})`)
                .join(', ')}
            </div>
          )}

          {/*
            Actions are status-driven, not just "the same two buttons for
            every job": a DRAFT has never been visible to candidates, so it
            can't have applicants (that button is hidden, not disabled — it
            has nothing to lead to) and its own "matches" is a preview, not
            live matching, so it's relabeled rather than left looking like a
            LIVE job's identical action. "Post job" is the one thing a draft
            actually needs and is the primary (default-styled) action here;
            Edit/Delete are secondary/danger so the row doesn't read as three
            equally-weighted choices.
          */}
          <div className="row" style={{ margin: 0, marginTop: 8, flexWrap: 'wrap' }}>
            {j.status === 'DRAFT' && (
              <button onClick={() => setJobStatus(j.id, 'LIVE')} disabled={statusUpdatingJobId === j.id}>
                {statusUpdatingJobId === j.id ? 'Posting…' : 'Post job'}
              </button>
            )}
            {j.status === 'LIVE' && (
              <button
                className="btn-secondary"
                onClick={() => setJobStatus(j.id, 'CLOSED')}
                disabled={statusUpdatingJobId === j.id}
              >
                {statusUpdatingJobId === j.id ? 'Closing…' : 'Unpublish'}
              </button>
            )}
            {j.status === 'CLOSED' && (
              <button
                className="btn-secondary"
                onClick={() => setJobStatus(j.id, 'LIVE')}
                disabled={statusUpdatingJobId === j.id}
              >
                {statusUpdatingJobId === j.id ? 'Reposting…' : 'Reopen'}
              </button>
            )}

            <button onClick={() => viewMatches(j.id)}>
              {matchesForJob === j.id
                ? 'Hide matches'
                : j.status === 'DRAFT'
                  ? 'Preview candidate pool'
                  : 'View matches'}
            </button>

            {j.status !== 'DRAFT' && (
              <button onClick={() => viewApplicants(j.id)}>
                {applicantsForJob === j.id ? 'Hide applicants' : 'View applicants'}
              </button>
            )}

            {j.status === 'DRAFT' && (
              <>
                <button className="btn-secondary" onClick={() => openEditForm(j)}>Edit</button>
                <button
                  className="btn-danger"
                  onClick={() => deleteDraft(j.id)}
                  disabled={deletingJobId === j.id}
                >
                  {deletingJobId === j.id ? 'Deleting…' : 'Delete draft'}
                </button>
              </>
            )}
          </div>

          {matchesForJob === j.id && (
            <div style={{ marginTop: 8 }}>
              {loadingMatches && <p className="meta" style={{ margin: 0 }}>Scoring candidates…</p>}
              {matchesError && <p className="error">{matchesError}</p>}
              {!loadingMatches && !matchesError && matches.length === 0 && (
                <p className="meta" style={{ margin: 0 }}>No matching candidates yet.</p>
              )}
              {matches.map((c) => (
                <div
                  key={c.profileId}
                  className="card"
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                    <strong>{c.fullName || 'Candidate'}</strong>
                    <div className="row" style={{ margin: 0 }}>
                      <span className="ok">{c.score}</span>
                      <ShortlistButton
                        candidateId={c.profileId}
                        jobId={j.id}
                        entryId={matchesShortlist[c.profileId] ?? null}
                        onAdded={(entryId) => setMatchesShortlist((prev) => ({ ...prev, [c.profileId]: entryId }))}
                        onRemoved={() => setMatchesShortlist((prev) => {
                          const next = { ...prev };
                          delete next[c.profileId];
                          return next;
                        })}
                        onError={setMatchesError}
                      />
                    </div>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${c.score}%` }} />
                  </div>
                  {c.headline && <div className="meta">{c.headline}</div>}
                  <div className="meta">
                    {c.location || 'Location not set'}
                    {c.yearsOfExp !== null && ` · ${c.yearsOfExp} yrs experience`}
                  </div>
                  <p style={{ margin: 0 }}>{c.aiExplanation}</p>
                  {c.matched.length > 0 && (
                    <div className="row" style={{ flexWrap: 'wrap', margin: 0 }}>
                      {c.matched.map((m) => (
                        <Link key={m.skillId} href={`/badges/${m.verifyHash}`}>
                          <button title={m.verifiedBy === 'DISCUSSION' ? 'Verified by discussion' : 'Verified by test'}>
                            {m.skillName} ({m.level}) {m.verifiedBy === 'DISCUSSION' ? '💬' : ''}
                          </button>
                        </Link>
                      ))}
                    </div>
                  )}
                  {c.missing.length > 0 && (
                    <div className="error" style={{ margin: 0, fontSize: '0.85rem' }}>
                      Gap:{' '}
                      {c.missing
                        .map((m) => {
                          const has = m.candidateLevel
                            ? `has ${m.verified ? 'verified' : 'unverified'} ${m.candidateLevel}`
                            : 'no claim';
                          return `${m.skillName} (needs ${m.requiredLevel}, ${has})`;
                        })
                        .join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {applicantsForJob === j.id && (
            <div style={{ marginTop: 8 }}>
              {loadingApplicants && <p className="meta" style={{ margin: 0 }}>Loading applicants…</p>}
              {applicantsError && <p className="error">{applicantsError}</p>}
              {!loadingApplicants && !applicantsError && applicants.length === 0 && (
                <p className="meta" style={{ margin: 0 }}>No applicants yet.</p>
              )}
              {applicants.map((a) => (
                <div
                  key={a.applicationId}
                  className="card"
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                    <strong>{a.fullName || 'Candidate'}</strong>
                    <div className="row" style={{ margin: 0 }}>
                      {a.score !== null && <span className="ok">{a.score}</span>}
                      <ShortlistButton
                        candidateId={a.profileId}
                        jobId={j.id}
                        entryId={applicantsShortlist[a.profileId] ?? null}
                        onAdded={(entryId) => setApplicantsShortlist((prev) => ({ ...prev, [a.profileId]: entryId }))}
                        onRemoved={() => setApplicantsShortlist((prev) => {
                          const next = { ...prev };
                          delete next[a.profileId];
                          return next;
                        })}
                        onError={setApplicantsError}
                      />
                    </div>
                  </div>
                  {a.profileIncomplete && (
                    <Badge variant="warning" style={{ alignSelf: 'flex-start' }}>Profile incomplete</Badge>
                  )}
                  {a.score !== null && (
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${a.score}%` }} />
                    </div>
                  )}
                  {a.headline && <div className="meta">{a.headline}</div>}
                  <div className="meta">
                    {a.location || 'Location not set'}
                    {a.yearsOfExp !== null && ` · ${a.yearsOfExp} yrs experience`}
                  </div>
                  <div className="meta">Applied {new Date(a.appliedAt).toLocaleDateString()}</div>

                  {a.verifiedSkills.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div className="meta" style={{ margin: 0, marginBottom: 4 }}>
                        SkillProof-Verified Skills
                      </div>
                      <div className="row" style={{ flexWrap: 'wrap', margin: 0 }}>
                        {a.verifiedSkills.map((s) => (
                          <Link key={s.skillId} href={`/badges/${s.verifyHash}`}>
                            <Badge variant="verified" title={s.verifiedBy === 'DISCUSSION' ? 'Verified by discussion' : 'Verified by test'}>
                              {s.skillName} ({s.level}) {s.verifiedBy === 'DISCUSSION' ? '💬' : ''}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Distinct, non-green tier — the employer judges relevance themselves, we only present. */}
                  {a.externalCredentials.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div className="meta" style={{ margin: 0, marginBottom: 4 }}>
                        External Credentials
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {a.externalCredentials.map((c) => (
                          <a
                            key={c.id}
                            href={c.credentialUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                          >
                            <Badge variant="default">{c.name ?? 'Credential'}</Badge>
                            <span className="meta" style={{ margin: 0 }}>
                              {ISSUER_LABELS[c.issuer]} · verified via Credly
                              {c.expiresAt && new Date(c.expiresAt) < new Date() ? ' · expired' : ''}
                            </span>
                            {c.nameMatchState === 'MISMATCH' && (
                              <Badge variant="warning">Name mismatch</Badge>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="row" style={{ alignItems: 'center', margin: 0 }}>
                    <span className="meta" style={{ margin: 0 }}>Status: {a.status}</span>
                    {STATUS_ACTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => updateApplicantStatus(a.applicationId, s)}
                        disabled={statusUpdating === a.applicationId || a.status === s}
                      >
                        {s}
                      </button>
                    ))}
                    {statusConfirmed === a.applicationId && (
                      <span className="ok" style={{ margin: 0 }}>✓ Updated</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
