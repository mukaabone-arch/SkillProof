'use client';

/**
 * Job posting: create form with a "Paste JD → Parse with AI" step that
 * pre-fills title/experience and suggests taxonomy skills, plus a list of
 * the org's existing jobs. Nothing is auto-saved — the employer reviews the
 * AI suggestions before "Save job" ever calls the API.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { employerApi, downloadBlob } from '@/lib/api';
import { Badge, EmptyState } from '@/components/ui';
import ShortlistButton from './ShortlistButton';
import ApplicantCard, { type ApplicantCardData } from './ApplicantCard';
import { LocationAutocomplete, LocationSuggestion } from './LocationAutocomplete';

const { api, apiBlob } = employerApi;

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
  /** Employer-assigned requisition reference, unique per org — see Job.code's doc comment on the API side. Internal only, never shown to candidates. */
  code: string;
  description: string;
  employmentType: string;
  /**
   * Structured city selection from GET /locations/search — non-null once
   * the job has had a city re-selected from the dropdown; locationCity is
   * the presence signal (see jobLocationDisplay below). ISO 3166-1
   * alpha-2 for locationCountry (e.g. "US"), never a display name.
   */
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  locationPlaceId: string | null;
  locationLat: number | null;
  locationLng: number | null;
  /** Pre-migration free-text value — never dropped. Shown as the current
   * location until locationCity is set; see jobLocationDisplay. */
  locationLegacy: string | null;
  remote: boolean;
  experienceMin: number | null;
  experienceMax: number | null;
  /** Paise, annual — see Job.salaryMin's own schema doc comment. Converted to/from rupees only at this component's own boundary (openEditForm/saveJob), never stored as rupees anywhere. */
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryNotDisclosed: boolean;
  status: JobStatus;
  skills: JobSkillView[];
}

/** GET /jobs already returns every scalar Job column (no `select`, only `include: { skills }`) — description/salary were just never read by the frontend before Edit needed to prefill a form with them. */

/** Structured-preferred display string, same precedence as the API's own formatLocation — never invented independently. */
function jobLocationDisplay(j: Pick<Job, 'locationCity' | 'locationRegion' | 'locationCountry' | 'locationLegacy'>): string {
  if (j.locationCity) return [j.locationCity, j.locationRegion, j.locationCountry].filter(Boolean).join(', ');
  return j.locationLegacy ?? '';
}

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
  code: string;
  description: string;
  employmentType: string;
  /** What's shown/typed in the location field — a formatted selection, the
   * legacy free-text value, or whatever the employer is currently typing. */
  locationText: string;
  /** Non-null only when the employer picked a suggestion from the dropdown
   * this session — that's what tells saveJob() to write the structured
   * fields instead of locationLegacy. Typing (without picking) clears this
   * back to null, same as a failed search falling back to free text. */
  locationStructured: LocationSuggestion | null;
  /** From the server at load — true means this job already has a
   * structured city on file, so the "re-select from the dropdown" prompt
   * never needs to show regardless of what's typed afterward. */
  hasStructuredLocationOnServer: boolean;
  remote: boolean;
  experienceMin: string;
  experienceMax: string;
  /** Rupees, as typed — the only place in this component's data that isn't paise. Converted to paise (×100) only when building the request body in saveJob(). */
  salaryMin: string;
  salaryMax: string;
  salaryNotDisclosed: boolean;
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

/** Applicant shape (identity, skills, credentials) lives in ApplicantCard — shared with the org-wide applicants page and dashboard preview. */
type Applicant = ApplicantCardData;

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
  code: '',
  description: '',
  employmentType: 'FULL_TIME',
  locationText: '',
  locationStructured: null,
  hasStructuredLocationOnServer: false,
  remote: false,
  experienceMin: '',
  experienceMax: '',
  salaryMin: '',
  salaryMax: '',
  salaryNotDisclosed: false,
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
  const [resumeDownloadingId, setResumeDownloadingId] = useState<string | null>(null);

  // Deep link from the dashboard's "Recent job postings" — opens that job's
  // applicants panel and scrolls to it, rather than landing on a plain list
  // the employer has to search through themselves.
  const openApplicantsJobId = useSearchParams().get('openApplicants');
  // Tracks which openApplicantsJobId value has already been auto-opened, so
  // the effect below fires at most once per deep-link value instead of on
  // every state change — see that effect's own comment for the bug this
  // fixes.
  const autoOpenedApplicantsJobId = useRef<string | null>(null);

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

  useEffect(() => {
    if (!openApplicantsJobId || jobs.length === 0) return;
    // Without this guard, closing the panel this effect just opened
    // (applicantsForJob -> null) made the old `applicantsForJob ===
    // openApplicantsJobId` check false again, re-running viewApplicants and
    // silently reopening it — "Hide applicants" looked like a no-op for any
    // job reached via this link. Firing at most once per deep-link value
    // (tracked by the ref, not by applicantsForJob) makes the toggle a
    // normal, independent open/close after the initial auto-open.
    if (autoOpenedApplicantsJobId.current === openApplicantsJobId) return;
    autoOpenedApplicantsJobId.current = openApplicantsJobId;
    viewApplicants(openApplicantsJobId);
    document.getElementById(`job-${openApplicantsJobId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openApplicantsJobId, jobs]);

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
      code: job.code,
      description: job.description,
      employmentType: job.employmentType,
      locationText: jobLocationDisplay(job),
      locationStructured: null,
      hasStructuredLocationOnServer: job.locationCity !== null,
      remote: job.remote,
      experienceMin: job.experienceMin !== null ? String(job.experienceMin) : '',
      experienceMax: job.experienceMax !== null ? String(job.experienceMax) : '',
      // Paise -> rupees, the only unit conversion in this form.
      salaryMin: job.salaryMin !== null ? String(job.salaryMin / 100) : '',
      salaryMax: job.salaryMax !== null ? String(job.salaryMax / 100) : '',
      salaryNotDisclosed: job.salaryNotDisclosed,
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

  async function viewApplicantResume(jobId: string, candidateId: string) {
    setResumeDownloadingId(candidateId);
    setApplicantsError('');
    try {
      const blob = await apiBlob(`/jobs/${jobId}/applicants/${candidateId}/resume`);
      downloadBlob(blob, 'resume.pdf');
    } catch (e) {
      setApplicantsError((e as Error).message);
    } finally {
      setResumeDownloadingId(null);
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
    if (!form.title.trim() || !form.code.trim() || !form.description.trim()) {
      setError('Title, job code, and description are required.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        code: form.code.trim(),
        description: form.description,
        employmentType: form.employmentType,
        remote: form.remote,
        status: form.status,
      };
      if (form.locationStructured) {
        // A real dropdown pick this session — write the structured fields,
        // never locationLegacy.
        body.locationCity = form.locationStructured.city;
        body.locationRegion = form.locationStructured.region || undefined;
        body.locationCountry = form.locationStructured.country;
        body.locationPlaceId = form.locationStructured.placeId;
        body.locationLat = form.locationStructured.lat ?? undefined;
        body.locationLng = form.locationStructured.lng ?? undefined;
      } else {
        // No structured pick this session (search failed, AI-parsed text,
        // or the employer just hasn't re-selected yet) — free text, never
        // dropped.
        body.locationLegacy = form.locationText || undefined;
      }
      if (form.experienceMin !== '') body.experienceMin = Number(form.experienceMin);
      if (form.experienceMax !== '') body.experienceMax = Number(form.experienceMax);
      body.salaryNotDisclosed = form.salaryNotDisclosed;
      if (form.salaryNotDisclosed) {
        // Explicit null, not omission — a PATCH that flips this flag without
        // clearing pre-existing amounts is rejected server-side (see
        // JobsService.update's own comment on why omission isn't enough here).
        body.salaryMin = null;
        body.salaryMax = null;
      } else {
        // Rupees -> paise, the API boundary — see Job.salaryMin's own schema doc comment.
        if (form.salaryMin !== '') body.salaryMin = Math.round(Number(form.salaryMin) * 100);
        if (form.salaryMax !== '') body.salaryMax = Math.round(Number(form.salaryMax) * 100);
      }

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
        {showForm && <h2 style={{ margin: 0 }}>{editingJobId ? 'Edit draft' : 'Post a job'}</h2>}
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
            <label htmlFor="jobCode">Job code</label>
            <input
              id="jobCode"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              maxLength={40}
              placeholder="e.g. SWE-01"
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
            <LocationAutocomplete
              id="location"
              value={form.locationText}
              onChangeText={(text) =>
                setForm((f) => ({ ...f, locationText: text, locationStructured: null }))
              }
              onSelect={(s) =>
                setForm((f) => ({
                  ...f,
                  locationText: [s.city, s.region, s.country].filter(Boolean).join(', '),
                  locationStructured: s,
                }))
              }
              placeholder="Start typing a city…"
              apiFetch={api}
            />
            {!form.hasStructuredLocationOnServer && !form.locationStructured && form.locationText && (
              <p className="meta" style={{ margin: 0 }}>
                This is the previously entered location — pick it from the dropdown above to make
                it official and keep it consistent with candidate locations for matching.
              </p>
            )}
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
            <label htmlFor="salaryMin">Annual salary range, ₹ (optional)</label>
            <div className="row" style={{ margin: 0 }}>
              <input
                id="salaryMin"
                type="number"
                min={0}
                placeholder="Min"
                value={form.salaryMin}
                disabled={form.salaryNotDisclosed}
                onChange={(e) => setForm({ ...form, salaryMin: e.target.value })}
              />
              <input
                type="number"
                min={0}
                placeholder="Max"
                value={form.salaryMax}
                disabled={form.salaryNotDisclosed}
                onChange={(e) => setForm({ ...form, salaryMax: e.target.value })}
              />
            </div>
            <label className="row" style={{ alignItems: 'center', marginTop: 8 }}>
              <input
                type="checkbox"
                checked={form.salaryNotDisclosed}
                onChange={(e) =>
                  setForm({
                    ...form,
                    salaryNotDisclosed: e.target.checked,
                    // Clear locally too, not just server-side — an
                    // employer re-checking "not disclosed" shouldn't leave
                    // stale numbers sitting in the (now-disabled) inputs.
                    ...(e.target.checked ? { salaryMin: '', salaryMax: '' } : {}),
                  })
                }
              />
              Salary not disclosed
            </label>
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
      {jobs.length === 0 && <EmptyState message="No jobs posted yet." />}
      {jobs.map((j) => (
        <div key={j.id} id={`job-${j.id}`} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <strong>{j.title}</strong>
            <Badge variant={JOB_STATUS_BADGE[j.status].variant}>{JOB_STATUS_BADGE[j.status].label}</Badge>
          </div>
          <div className="meta">
            {j.code} · {j.employmentType.replace('_', ' ')} · {j.remote ? 'Remote' : jobLocationDisplay(j) || 'Location not set'}
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
                <ApplicantCard
                  key={a.applicationId}
                  applicant={a}
                  headerActions={
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
                  }
                  resumeAction={
                    a.hasResume ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => viewApplicantResume(j.id, a.profileId)}
                        disabled={resumeDownloadingId === a.profileId}
                      >
                        {resumeDownloadingId === a.profileId ? 'Downloading…' : 'View resume'}
                      </button>
                    ) : undefined
                  }
                  footer={
                    <div className="row" style={{ alignItems: 'center', margin: 0, flexWrap: 'wrap' }}>
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
                  }
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
