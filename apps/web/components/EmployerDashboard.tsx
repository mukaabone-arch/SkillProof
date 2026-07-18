'use client';

/**
 * Org-wide pipeline KPIs — a read layer over ShortlistEntry.stage, no new
 * state of its own. Five cards in funnel order (SHORTLISTED → HIRED); each
 * links to the existing shortlist view pre-filtered to that stage (see
 * EmployerShortlist's `stage`/`jobId` search-param handling) rather than
 * building a second list view here. The three terminal non-KPI stages
 * (declined/rejected/closed) are surfaced as a small reconciliation line,
 * not their own cards, per the spec.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

interface Job {
  id: string;
  title: string;
}

interface DashboardSummary {
  jobId: string | null;
  jobTitle: string | null;
  kpis: {
    shortlisted: number;
    interviewPending: number;
    interviewing: number;
    offersOut: number;
    hired: number;
  };
  other: {
    declined: number;
    rejected: number;
    closed: number;
  };
  total: number;
}

const KPI_CARDS: { key: keyof DashboardSummary['kpis']; label: string; stage: string }[] = [
  { key: 'shortlisted', label: 'Shortlisted', stage: 'SHORTLISTED' },
  { key: 'interviewPending', label: 'Interview pending', stage: 'INVITED' },
  { key: 'interviewing', label: 'Interviewing', stage: 'INTERVIEWING' },
  { key: 'offersOut', label: 'Offers out', stage: 'OFFER' },
  { key: 'hired', label: 'Hired', stage: 'HIRED' },
];

export default function EmployerDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobFilter, setJobFilter] = useState('');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Job[]>('/jobs').then(setJobs).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobFilter]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const qs = jobFilter ? `?jobId=${jobFilter}` : '';
      setSummary(await api<DashboardSummary>(`/employer/dashboard${qs}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const maxKpi = summary ? Math.max(1, ...Object.values(summary.kpis)) : 1;
  const shortlistHref = (stage: string) => `/employer/shortlist?stage=${stage}${jobFilter ? `&jobId=${jobFilter}` : ''}`;

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Your hiring pipeline at a glance — click any stage to see who&apos;s in it.</p>

      {jobs.length > 0 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="dashboardJobFilter">Role</label>
          <select id="dashboardJobFilter" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
            <option value="">All roles</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p className="meta">Loading…</p>}

      {!loading && summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(140px, 1fr))', gap: 16, marginTop: 8 }}>
            {KPI_CARDS.map((card) => {
              const count = summary.kpis[card.key];
              return (
                <Link key={card.key} href={shortlistHref(card.stage)} className="status-card">
                  <div className="status-card-label">{card.label}</div>
                  <div className="status-stat">{count}</div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${(count / maxKpi) * 100}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>

          <p className="meta" style={{ marginTop: 16 }}>
            {summary.total} total in pipeline{summary.jobTitle ? ` for ${summary.jobTitle}` : ''} ·{' '}
            {summary.other.declined} declined · {summary.other.rejected} rejected · {summary.other.closed} closed
          </p>
        </>
      )}
    </main>
  );
}
