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

interface Job {
  id: string;
  title: string;
  employmentType: string;
  location: string | null;
  remote: boolean;
  experienceMin: number | null;
  experienceMax: number | null;
  status: string;
  skills: JobSkillView[];
}

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
  verifyHash: string;
}

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
  const [form, setForm] = useState<JobForm>(emptyForm);
  const [suggested, setSuggested] = useState<SuggestedSkill[]>([]);
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);

  const [matchesForJob, setMatchesForJob] = useState<string | null>(null);
  const [matches, setMatches] = useState<CandidateMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchesError, setMatchesError] = useState('');

  const [applicantsForJob, setApplicantsForJob] = useState<string | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loadingApplicants, setLoadingApplicants] = useState(false);
  const [applicantsError, setApplicantsError] = useState('');
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
    setShowForm(true);
    setForm(emptyForm);
    setSuggested([]);
    setError('');
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

  async function viewMatches(jobId: string) {
    if (matchesForJob === jobId) {
      setMatchesForJob(null);
      return;
    }
    setMatchesForJob(jobId);
    setMatches([]);
    setMatchesError('');
    setLoadingMatches(true);
    try {
      const res = await api<MatchesResponse>(`/jobs/${jobId}/matches`);
      setMatches(res.candidates);
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
    setApplicantsError('');
    setLoadingApplicants(true);
    try {
      const res = await api<Applicant[]>(`/jobs/${jobId}/applicants`);
      setApplicants(res);
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

  async function createJob() {
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

      const job = await api<Job>('/jobs', { method: 'POST', body: JSON.stringify(body) });

      if (suggested.length > 0) {
        await api(`/jobs/${job.id}/skills`, {
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
        <h2 style={{ margin: 0 }}>Post a job</h2>
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
            <button onClick={createJob} disabled={creating}>
              {creating ? 'Saving…' : 'Save job'}
            </button>
            <button onClick={() => setShowForm(false)} disabled={creating}>Cancel</button>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 32, marginBottom: 16 }}>Your jobs</h2>
      {jobs.length === 0 && <p>No jobs posted yet.</p>}
      {jobs.map((j) => (
        <div key={j.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <strong>{j.title}</strong>
            <span className={j.status === 'LIVE' ? 'ok' : 'meta'}>{j.status}</span>
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

          <div className="row" style={{ margin: 0, marginTop: 8 }}>
            <button onClick={() => viewMatches(j.id)}>
              {matchesForJob === j.id ? 'Hide matches' : 'View matches'}
            </button>
            <button onClick={() => viewApplicants(j.id)}>
              {applicantsForJob === j.id ? 'Hide applicants' : 'View applicants'}
            </button>
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
                    <span className="ok">{c.score}</span>
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
                          <button>{m.skillName} ({m.level})</button>
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
                    {a.score !== null && <span className="ok">{a.score}</span>}
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
                    <div className="row" style={{ flexWrap: 'wrap', margin: 0 }}>
                      {a.verifiedSkills.map((s) => (
                        <Link key={s.skillId} href={`/badges/${s.verifyHash}`}>
                          <button>{s.skillName} ({s.level})</button>
                        </Link>
                      ))}
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
