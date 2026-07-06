'use client';

/**
 * Job posting: create form with a "Paste JD → Parse with AI" step that
 * pre-fills title/experience and suggests taxonomy skills, plus a list of
 * the org's existing jobs. Nothing is auto-saved — the employer reviews the
 * AI suggestions before "Save job" ever calls the API.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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

  useEffect(() => {
    api<Job[]>('/jobs').then(setJobs).catch((e) => setError(e.message));
    api<Domain[]>('/taxonomy')
      .then((domains) => {
        const map: Record<string, string> = {};
        domains.forEach((d) => d.skills.forEach((s) => { map[s.name] = s.id; }));
        setSkillIdByName(map);
      })
      .catch(() => undefined);
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

      setSuggested(
        result.suggestedSkills
          .filter((s) => skillIdByName[s.skillName])
          .map((s) => ({
            skillId: skillIdByName[s.skillName],
            skillName: s.skillName,
            requiredLevel: s.requiredLevel,
            isRequired: s.isRequired,
          })),
      );
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
        </div>
      ))}
    </>
  );
}
