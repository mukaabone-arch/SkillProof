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
 * "Invite your team" nudge — the one item left from the old three-item
 * "Set up your organisation" checklist that's still optional. Logo and
 * industry/website dropped off this card entirely once they became
 * mandatory (see app/employer/setup/page.tsx and OrgSetupCompleteGuard on
 * the API side): an org can't reach this dashboard at all until both are
 * set, so showing them here again would always read done — dead weight,
 * not signal. Derived on read server-side (DashboardService.hasInvitedTeam),
 * not a stored flag. Deliberately not gating anything: an org can post a
 * job and hire with no teammates invited, same as today — this is a nudge,
 * not a requirement.
 */
/** Per-org, not global — a person on more than one org's dashboard (rare, but the data model allows it) shouldn't have dismissing one org's nudge hide another's. */
function teamNudgeDismissKey(orgId: string): string {
  return `team-nudge-dismissed:${orgId}`;
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
  invitedTeam: boolean;
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
  const [teamNudgeDismissed, setTeamNudgeDismissed] = useState(false);

  useEffect(() => {
    api<Job[]>('/jobs').then(setJobs).catch(() => undefined);
  }, []);

  // Read once summary.orgId is known — localStorage isn't available during
  // server rendering, so this can only run post-mount (same reasoning as
  // JobDetailPage's getToken() read).
  useEffect(() => {
    if (!summary) return;
    setTeamNudgeDismissed(localStorage.getItem(teamNudgeDismissKey(summary.orgId)) === '1');
  }, [summary?.orgId]);

  function dismissTeamNudge() {
    if (!summary) return;
    localStorage.setItem(teamNudgeDismissKey(summary.orgId), '1');
    setTeamNudgeDismissed(true);
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
          {!summary.invitedTeam && !teamNudgeDismissed && (
            <div className="card status-card-flag" style={{ justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong>Invite your team</strong>
                <p className="meta" style={{ margin: 0 }}>Bring colleagues in to help manage hiring — entirely optional.</p>
              </div>
              <div className="row" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
                <Link href="/employer/settings#team">
                  <button className="btn-secondary">Invite team →</button>
                </Link>
                <button className="btn-secondary" onClick={dismissTeamNudge}>Dismiss</button>
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
