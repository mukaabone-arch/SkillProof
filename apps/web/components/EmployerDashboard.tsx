'use client';

/**
 * Dashboard home: four org-level KPI cards, recent-activity previews, and
 * (unchanged) the pipeline-funnel view that used to be the entire page.
 * Extends the existing /employer/dashboard endpoint/response rather than
 * standing up a second dashboard — see DashboardService.summary/orgOverview
 * for what backs each field and why avgTimeToHireDays can be null (real
 * absence of data, never fabricated).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import { EmptyState } from '@/components/ui';
import ApplicantCard, { type ApplicantCardData } from './ApplicantCard';

const { api } = employerApi;

interface Job {
  id: string;
  title: string;
}

interface RecentJob {
  id: string;
  title: string;
  status: 'DRAFT' | 'LIVE' | 'CLOSED';
  applicantCount: number;
  createdAt: string;
}

type RecentApplicant = ApplicantCardData & { jobId: string; jobTitle: string };

/**
 * "Set up your organisation" checklist — derived on read server-side
 * (DashboardService.setupChecklist), not a stored flag, so un-ticking an
 * item when its underlying data is removed (e.g. the logo is deleted) is
 * automatic. Deliberately not gating anything: an org can post a job and
 * hire with every item incomplete, same as today.
 */
interface SetupChecklist {
  items: { invitedTeam: boolean; logo: boolean; companyInfo: boolean };
  doneCount: number;
  total: number;
  allDone: boolean;
}

const SETUP_ITEMS: { key: keyof SetupChecklist['items']; label: string; href: string }[] = [
  { key: 'invitedTeam', label: 'Invite your team', href: '/employer/settings#team' },
  { key: 'logo', label: 'Add your company logo', href: '/employer/settings#organisation' },
  { key: 'companyInfo', label: 'Add your industry and website', href: '/employer/settings#organisation' },
];

/** Per-org, not global — a person on more than one org's dashboard (rare, but the data model allows it) shouldn't have dismissing one org's checklist hide another's. */
function setupDismissKey(orgId: string): string {
  return `setup-dismissed:${orgId}`;
}

interface DashboardSummary {
  orgId: string;
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
  activeJobs: number;
  totalApplicants: number;
  applicantsThisMonth: number;
  avgTimeToHireDays: number | null;
  recentJobs: RecentJob[];
  recentApplicants: RecentApplicant[];
  setup: SetupChecklist;
}

const KPI_CARDS: { key: keyof DashboardSummary['kpis']; label: string; stage: string }[] = [
  { key: 'shortlisted', label: 'Shortlisted', stage: 'SHORTLISTED' },
  { key: 'interviewPending', label: 'Interview pending', stage: 'INVITED' },
  { key: 'interviewing', label: 'Interviewing', stage: 'INTERVIEWING' },
  { key: 'offersOut', label: 'Offers out', stage: 'OFFER' },
  { key: 'hired', label: 'Hired', stage: 'HIRED' },
];

const JOB_STATUS_LABEL: Record<RecentJob['status'], string> = { DRAFT: 'Draft', LIVE: 'Live', CLOSED: 'Closed' };

export default function EmployerDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobFilter, setJobFilter] = useState('');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [setupDismissed, setSetupDismissed] = useState(false);

  useEffect(() => {
    api<Job[]>('/jobs').then(setJobs).catch(() => undefined);
  }, []);

  // Read once summary.orgId is known — localStorage isn't available during
  // server rendering, so this can only run post-mount (same reasoning as
  // JobDetailPage's getToken() read).
  useEffect(() => {
    if (!summary) return;
    setSetupDismissed(localStorage.getItem(setupDismissKey(summary.orgId)) === '1');
  }, [summary?.orgId]);

  function dismissSetup() {
    if (!summary) return;
    localStorage.setItem(setupDismissKey(summary.orgId), '1');
    setSetupDismissed(true);
  }

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
    <main className="container-wide">
      <h1>Dashboard</h1>
      <p>Your hiring at a glance.</p>

      {error && <p className="error">{error}</p>}
      {loading && <p className="meta">Loading…</p>}

      {!loading && summary && (
        <>
          {!summary.setup.allDone && !setupDismissed && (
            <div className="card status-card-flag" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, marginBottom: 24 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <h2 style={{ margin: 0 }}>Set up your organisation</h2>
                <div className="row" style={{ margin: 0, alignItems: 'center', gap: 12 }}>
                  <span className="meta" style={{ margin: 0 }}>
                    {summary.setup.doneCount} of {summary.setup.total} done
                  </span>
                  <button className="btn-secondary" onClick={dismissSetup}>Dismiss</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SETUP_ITEMS.map((item) => {
                  const done = summary.setup.items[item.key];
                  return done ? (
                    <div key={item.key} className="row" style={{ margin: 0, gap: 8, alignItems: 'center' }}>
                      <span aria-hidden="true" className="ok">✓</span>
                      <span>{item.label}</span>
                    </div>
                  ) : (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="row"
                      style={{ margin: 0, gap: 8, alignItems: 'center' }}
                    >
                      <span aria-hidden="true" style={{ color: 'var(--ink-60)' }}>○</span>
                      <span style={{ flex: 1 }}>{item.label}</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <div className="dashboard-overview-grid">
            <Link href="/employer/jobs" className="status-card">
              <div className="status-card-label">Active Jobs</div>
              <div className="status-stat">{summary.activeJobs}</div>
              <p className="meta" style={{ margin: 0 }}>Currently live</p>
            </Link>
            <Link href="/employer/applicants" className="status-card">
              <div className="status-card-label">Total Applicants</div>
              <div className="status-stat">{summary.totalApplicants}</div>
              <p className="meta" style={{ margin: 0 }}>All-time, across every job</p>
            </Link>
            <Link href="/employer/applicants" className="status-card">
              <div className="status-card-label">New Applicants This Month</div>
              <div className="status-stat">{summary.applicantsThisMonth}</div>
              <p className="meta" style={{ margin: 0 }}>Since the 1st of this month</p>
            </Link>
            <div className="status-card">
              <div className="status-card-label">Avg. Time to Hire</div>
              {summary.avgTimeToHireDays !== null ? (
                <>
                  <div className="status-stat">{summary.avgTimeToHireDays}d</div>
                  <p className="meta" style={{ margin: 0 }}>Shortlisted → hired</p>
                </>
              ) : (
                <p className="meta" style={{ margin: 0 }}>Not enough data yet — this fills in once a candidate is marked Hired.</p>
              )}
            </div>
          </div>

          <div className="dashboard-recent-grid">
            <section className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <h2 style={{ margin: 0 }}>Recent job postings</h2>
                <Link href="/employer/jobs">View all</Link>
              </div>
              {summary.recentJobs.length === 0 ? (
                <EmptyState message="No jobs posted yet." actionLabel="Post your first job" actionHref="/employer/jobs" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                  {summary.recentJobs.map((j) => (
                    <Link
                      key={j.id}
                      href={`/employer/jobs?openApplicants=${j.id}`}
                      className="card"
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                        <strong>{j.title}</strong>
                        <span className="meta" style={{ margin: 0 }}>{JOB_STATUS_LABEL[j.status]}</span>
                      </div>
                      <span className="meta" style={{ margin: 0 }}>
                        {j.applicantCount} applicant{j.applicantCount === 1 ? '' : 's'} · posted {new Date(j.createdAt).toLocaleDateString()}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <h2 style={{ margin: 0 }}>Recent applicants</h2>
                <Link href="/employer/applicants">View all</Link>
              </div>
              {summary.recentApplicants.length === 0 ? (
                <EmptyState message="No applicants yet — candidates will appear here once they apply." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                  {summary.recentApplicants.map((a) => (
                    <ApplicantCard
                      key={a.applicationId}
                      applicant={a}
                      compact
                      footer={
                        <Link href={`/employer/jobs?openApplicants=${a.jobId}`} className="meta" style={{ margin: 0 }}>
                          Applied for {a.jobTitle}
                        </Link>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <h2 style={{ marginTop: 32 }}>Pipeline</h2>
          <p className="meta" style={{ marginTop: -8 }}>Click any stage to see who&apos;s in it.</p>

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

          {/*
            auto-fit, not a fixed repeat(5, ...): below ~764px of
            available width, 5 columns at the 140px floor no longer fit —
            auto-fit drops to however many do (4, then 3, then 2...) and
            wraps the rest onto additional rows instead of overflowing.
            KPI_CARDS' own order (funnel stage order, left to right) is
            untouched, so row-by-row reading still runs the funnel in
            order even when it wraps — e.g. at 4 columns the last card
            (Hired) just sits alone on its own second row.
          */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginTop: 8 }}>
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
