'use client';

/** Job detail: full public job info + Apply (disabled once already applied). */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, getToken, type ApiError } from '@/lib/api';
import { JobDescription } from '@/components/ui';
import { useEntitlements } from '@/lib/entitlements';
import { UsageMeter } from '@/components/UsageMeter';

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

/** Machine-readable codes the backend returns when apply-time requirements aren't met. */
interface ApplyIssueBody {
  code?: 'PROFILE_INCOMPLETE' | 'BADGE_REQUIRED';
  message?: string;
}

interface SkillGap {
  skillId: string;
  skillName: string;
  requiredLevel: string;
  candidateLevel: string | null;
  verified: boolean;
}
interface MatchedJobLite {
  id: string;
  missing: SkillGap[];
}
interface MatchedResponse {
  jobs: MatchedJobLite[];
}

/**
 * Gap analysis: basic (all tiers) is just the missing-skill list, already
 * available from GET /jobs/matched. Detailed (Premium, gapAnalysis:
 * 'detailed') additionally ties those gaps to this job's own real salary
 * range — no per-skill $ figures are invented; the only number shown is
 * this job's actual salaryMin/salaryMax, already public on this same page.
 */
function GapAnalysis({ missing, job, detailed }: { missing: SkillGap[]; job: JobDetail; detailed: boolean }) {
  if (missing.length === 0) return null;
  const hasSalary = job.salaryMin !== null || job.salaryMax !== null;

  return (
    <div className="field">
      <label>Skill gap for this role</label>
      <p style={{ margin: 0 }}>
        Missing: {missing.map((m) => `${m.skillName} (${m.requiredLevel})`).join(', ')}
      </p>
      {detailed && hasSalary && (
        <p className="meta" style={{ marginTop: 6 }}>
          Closing these gaps puts you in range for roles paying{' '}
          {job.salaryMin ?? '?'}–{job.salaryMax ?? '?'} — like this one.
        </p>
      )}
      {!detailed && (
        <p className="meta" style={{ marginTop: 6 }}>
          <Link href="/upgrade">Upgrade</Link> to see which salary bands closing these gaps unlocks.
        </p>
      )}
    </div>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [applyIssue, setApplyIssue] = useState<ApplyIssueBody | null>(null);
  const [missing, setMissing] = useState<SkillGap[]>([]);
  // Set post-mount, not read via getToken() directly in render — that
  // reads localStorage synchronously, which doesn't exist during server
  // rendering, so calling it in the render body disagrees between server
  // and client and triggers a real hydration-mismatch error (pre-existing;
  // fixed here alongside the rest of this file's entitlements work).
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const { limits, usage, refetch } = useEntitlements();

  const load = useCallback(async () => {
    try {
      setJob(await api<JobDetail>(`/jobs/browse/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
    // Best-effort — no matched entry (e.g. no verified skills yet) just means no gap section renders.
    api<MatchedResponse>('/jobs/matched')
      .then((res) => setMissing(res.jobs.find((j) => j.id === id)?.missing ?? []))
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    const hasToken = !!getToken();
    setLoggedIn(hasToken);
    if (hasToken) load();
  }, [load]);

  async function apply() {
    setApplying(true);
    setApplyError('');
    setApplyIssue(null);
    try {
      await api(`/jobs/${id}/apply`, { method: 'POST' });
      setJob((j) => (j ? { ...j, alreadyApplied: true } : j));
      // Applying consumes a unit of the 'applications' quota — refetch so
      // the meter reflects reality rather than being optimistically patched.
      void refetch();
    } catch (e) {
      const body = (e as ApiError).body as ApplyIssueBody | undefined;
      if (body?.code === 'PROFILE_INCOMPLETE' || body?.code === 'BADGE_REQUIRED') {
        setApplyIssue(body);
      } else {
        setApplyError((e as Error).message);
      }
      // A downstream 4xx here (PROFILE_INCOMPLETE, BADGE_REQUIRED, already-
      // applied 409, job-not-found 404) is refunded server-side — refetch
      // rather than assume the meter is still accurate either way.
      void refetch();
    } finally {
      setApplying(false);
    }
  }

  if (loggedIn === null) return <main><p>Loading job…</p></main>;

  if (!loggedIn) {
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
        <JobDescription description={job.description} />
      </div>

      {limits && <GapAnalysis missing={missing} job={job} detailed={limits.gapAnalysis === 'detailed'} />}

      {usage && !job.alreadyApplied && (
        <UsageMeter
          label="applications"
          used={usage.applications.used}
          limit={usage.applications.limit}
          resetsAt={usage.applications.resetsAt}
        />
      )}

      <div className="row" style={{ alignItems: 'center' }}>
        <button onClick={apply} disabled={applying || job.alreadyApplied}>
          {job.alreadyApplied ? 'Applied' : applying ? 'Applying…' : 'Apply'}
        </button>
        {job.alreadyApplied && <span className="ok">✓ You&apos;ve applied to this job</span>}
      </div>

      {applyIssue?.code === 'PROFILE_INCOMPLETE' && (
        <p className="meta">
          Almost there — add your name and experience so this employer knows who&apos;s applying.{' '}
          <Link href={`/profile?returnTo=/jobs/${id}`}>Complete your profile →</Link>
        </p>
      )}
      {applyIssue?.code === 'BADGE_REQUIRED' && (
        <p className="meta">
          {applyIssue.message}{' '}
          <Link href={`/assessments?returnTo=/jobs/${id}`}>Take an assessment →</Link>
        </p>
      )}
      {applyError && <p className="error">{applyError}</p>}
    </main>
  );
}
