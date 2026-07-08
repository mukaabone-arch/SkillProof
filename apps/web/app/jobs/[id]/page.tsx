'use client';

/** Job detail: full public job info + Apply (disabled once already applied). */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

interface JobSkillView {
  skillId: string;
  skillName: string;
  requiredLevel: string;
  isRequired: boolean;
}

interface JobDetail {
  id: string;
  title: string;
  orgName: string;
  employmentType: string;
  location: string | null;
  remote: boolean;
  experienceMin: number | null;
  experienceMax: number | null;
  description: string;
  salaryMin: number | null;
  salaryMax: number | null;
  skills: JobSkillView[];
  alreadyApplied: boolean;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const load = useCallback(async () => {
    try {
      setJob(await api<JobDetail>(`/jobs/browse/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    if (getToken()) load();
  }, [load]);

  async function apply() {
    setApplying(true);
    setApplyError('');
    try {
      await api(`/jobs/${id}/apply`, { method: 'POST' });
      setJob((j) => (j ? { ...j, alreadyApplied: true } : j));
    } catch (e) {
      setApplyError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  if (!getToken()) {
    return (
      <main>
        <p className="error">
          You are not logged in — <Link href="/">log in first</Link> to view this job.
        </p>
      </main>
    );
  }

  if (error) return <main><p className="error">{error}</p></main>;
  if (!job) return <main><p>Loading job…</p></main>;

  return (
    <main>
      <Link href="/jobs">← Back to jobs</Link>
      <h1 style={{ marginTop: 16 }}>{job.title}</h1>
      <p className="meta" style={{ fontSize: '1rem' }}>
        {job.orgName} · {job.employmentType.replace('_', ' ')} ·{' '}
        {job.remote ? 'Remote' : job.location || 'Location not set'}
        {(job.experienceMin !== null || job.experienceMax !== null) &&
          ` · ${job.experienceMin ?? 0}–${job.experienceMax ?? '∞'} yrs experience`}
      </p>
      {(job.salaryMin !== null || job.salaryMax !== null) && (
        <p className="meta" style={{ fontSize: '1rem' }}>
          Salary: {job.salaryMin ?? '?'}–{job.salaryMax ?? '?'}
        </p>
      )}

      {job.skills.length > 0 && (
        <div className="field">
          <label>Required skills</label>
          <p style={{ margin: 0 }}>
            {job.skills
              .map((s) => `${s.skillName} (${s.requiredLevel}${s.isRequired ? '' : ', optional'})`)
              .join(', ')}
          </p>
        </div>
      )}

      <div className="field">
        <label>Description</label>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{job.description}</p>
      </div>

      <div className="row" style={{ alignItems: 'center' }}>
        <button onClick={apply} disabled={applying || job.alreadyApplied}>
          {job.alreadyApplied ? 'Applied' : applying ? 'Applying…' : 'Apply'}
        </button>
        {job.alreadyApplied && <span className="ok">✓ You&apos;ve applied to this job</span>}
      </div>
      {applyError && <p className="error">{applyError}</p>}
    </main>
  );
}
