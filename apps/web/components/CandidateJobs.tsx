'use client';

/**
 * Candidate job area: browse/search LIVE jobs, see jobs ranked by fit score
 * (GET /jobs/matched — scored server-side by the same scoring.ts used on the
 * employer side), and track your own applications. Job detail + apply lives
 * at /jobs/[id].
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
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
  skillId: string;
  skillName: string;
  requiredLevel: string;
  isRequired: boolean;
}

export interface JobSummary {
  id: string;
  title: string;
  orgName: string;
  employmentType: string;
  location: string | null;
  remote: boolean;
  experienceMin: number | null;
  experienceMax: number | null;
  skills: JobSkillView[];
  alreadyApplied: boolean;
}

interface BrowseResponse {
  total: number;
  limit: number;
  offset: number;
  jobs: JobSummary[];
}

interface SkillGap {
  skillId: string;
  skillName: string;
  requiredLevel: string;
  candidateLevel: string | null;
  verified: boolean;
}

interface MatchedJob extends JobSummary {
  score: number;
  matched: SkillGap[];
  missing: SkillGap[];
}

interface MatchedResponse {
  jobs: MatchedJob[];
}

interface MyApplication {
  id: string;
  status: string;
  createdAt: string;
  job: {
    id: string;
    title: string;
    orgName: string;
    employmentType: string;
    location: string | null;
    remote: boolean;
  };
}

type Tab = 'matched' | 'browse' | 'applications';

function JobMeta({ job }: { job: JobSummary }) {
  return (
    <div className="meta">
      {job.orgName} · {job.employmentType.replace('_', ' ')} ·{' '}
      {job.remote ? 'Remote' : job.location || 'Location not set'}
      {(job.experienceMin !== null || job.experienceMax !== null) &&
        ` · ${job.experienceMin ?? 0}–${job.experienceMax ?? '∞'} yrs`}
    </div>
  );
}

function JobSkills({ skills }: { skills: JobSkillView[] }) {
  if (skills.length === 0) return null;
  return (
    <div className="meta">
      Skills:{' '}
      {skills
        .map((s) => `${s.skillName} (${s.requiredLevel}${s.isRequired ? '' : ', optional'})`)
        .join(', ')}
    </div>
  );
}

export default function CandidateJobs() {
  const [tab, setTab] = useState<Tab>('matched');
  const [domains, setDomains] = useState<Domain[]>([]);

  const [skillId, setSkillId] = useState('');
  const [location, setLocation] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [browsed, setBrowsed] = useState<JobSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState('');

  const [matched, setMatched] = useState<MatchedJob[]>([]);
  const [loadingMatched, setLoadingMatched] = useState(false);
  const [matchedError, setMatchedError] = useState('');

  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [applicationsError, setApplicationsError] = useState('');

  useEffect(() => {
    api<Domain[]>('/taxonomy').then(setDomains).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab === 'matched' && matched.length === 0 && !loadingMatched) loadMatched();
    if (tab === 'browse' && total === null && !browsing) browse();
    if (tab === 'applications' && applications.length === 0 && !loadingApplications) loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadMatched() {
    setLoadingMatched(true);
    setMatchedError('');
    try {
      const res = await api<MatchedResponse>('/jobs/matched');
      setMatched(res.jobs);
    } catch (e) {
      setMatchedError((e as Error).message);
    } finally {
      setLoadingMatched(false);
    }
  }

  async function browse() {
    setBrowsing(true);
    setBrowseError('');
    try {
      const params = new URLSearchParams();
      if (skillId) params.set('skillId', skillId);
      if (location.trim()) params.set('location', location.trim());
      if (remoteOnly) params.set('remote', 'true');

      const res = await api<BrowseResponse>(`/jobs/browse?${params.toString()}`);
      setBrowsed(res.jobs);
      setTotal(res.total);
    } catch (e) {
      setBrowseError((e as Error).message);
    } finally {
      setBrowsing(false);
    }
  }

  async function loadApplications() {
    setLoadingApplications(true);
    setApplicationsError('');
    try {
      setApplications(await api<MyApplication[]>('/applications/me'));
    } catch (e) {
      setApplicationsError((e as Error).message);
    } finally {
      setLoadingApplications(false);
    }
  }

  return (
    <>
      <div className="row" style={{ marginTop: 32, marginBottom: 16 }}>
        <button onClick={() => setTab('matched')} disabled={tab === 'matched'}>Matched to you</button>
        <button onClick={() => setTab('browse')} disabled={tab === 'browse'}>Browse jobs</button>
        <button onClick={() => setTab('applications')} disabled={tab === 'applications'}>
          My applications
        </button>
      </div>

      {tab === 'matched' && (
        <>
          {loadingMatched && <p className="meta">Scoring jobs against your verified skills…</p>}
          {matchedError && <p className="error">{matchedError}</p>}
          {!loadingMatched && !matchedError && matched.length === 0 && (
            <p>
              No live jobs to score yet.{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setTab('browse'); }}>
                Browse all jobs →
              </a>
            </p>
          )}
          {matched.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                  <strong style={{ color: 'var(--ink)' }}>{j.title}</strong>
                  <span className="ok">{j.score}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${j.score}%` }} />
                </div>
                <JobMeta job={j} />
                <JobSkills skills={j.skills} />
                {j.alreadyApplied && <span className="ok">✓ Applied</span>}
              </div>
            </Link>
          ))}
        </>
      )}

      {tab === 'browse' && (
        <>
          <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <div className="field">
              <label htmlFor="jobSkill">Skill</label>
              <select id="jobSkill" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                <option value="">Any skill</option>
                {domains.map((d) => (
                  <optgroup key={d.id} label={d.name}>
                    {d.skills.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="jobLocation">Location</label>
              <input
                id="jobLocation"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Bengaluru"
              />
            </div>

            <label className="row" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={remoteOnly}
                onChange={(e) => setRemoteOnly(e.target.checked)}
              />
              Remote only
            </label>

            <button onClick={browse} disabled={browsing}>
              {browsing ? 'Searching…' : 'Search'}
            </button>
          </div>

          {browseError && <p className="error">{browseError}</p>}
          {total !== null && (
            <p className="meta" style={{ marginTop: 12 }}>
              {total} job{total === 1 ? '' : 's'} found
            </p>
          )}
          {browsed.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                  <strong style={{ color: 'var(--ink)' }}>{j.title}</strong>
                  {j.alreadyApplied && <span className="ok">✓ Applied</span>}
                </div>
                <JobMeta job={j} />
                <JobSkills skills={j.skills} />
              </div>
            </Link>
          ))}
        </>
      )}

      {tab === 'applications' && (
        <>
          {loadingApplications && <p className="meta">Loading your applications…</p>}
          {applicationsError && <p className="error">{applicationsError}</p>}
          {!loadingApplications && !applicationsError && applications.length === 0 && (
            <p>You haven&apos;t applied to any jobs yet.</p>
          )}
          {applications.map((a) => (
            <div key={a.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <strong>{a.job.title}</strong>
                <span className="meta">{a.status}</span>
              </div>
              <div className="meta">
                {a.job.orgName} · {a.job.employmentType.replace('_', ' ')} ·{' '}
                {a.job.remote ? 'Remote' : a.job.location || 'Location not set'}
              </div>
              <div className="meta">Applied {new Date(a.createdAt).toLocaleDateString()}</div>
              <Link href={`/jobs/${a.job.id}`}>View job →</Link>
            </div>
          ))}
        </>
      )}
    </>
  );
}
