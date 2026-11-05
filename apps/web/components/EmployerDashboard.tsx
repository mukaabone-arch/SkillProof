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
import { useLocale, useTranslations } from 'next-intl';
import { employerApi } from '@/lib/api';
import { intlTag } from '@/lib/formatLocale';
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

/** `stage` is the ShortlistStage the card links to; `labelKey` names its entry under employerDashboard.stage. */
const KPI_CARDS: { key: keyof DashboardSummary['kpis']; labelKey: string; stage: string }[] = [
  { key: 'shortlisted', labelKey: 'shortlisted', stage: 'SHORTLISTED' },
  { key: 'interviewPending', labelKey: 'interviewPending', stage: 'INVITED' },
  { key: 'interviewing', labelKey: 'interviewing', stage: 'INTERVIEWING' },
  { key: 'offersOut', labelKey: 'offersOut', stage: 'OFFER' },
  { key: 'hired', labelKey: 'hired', stage: 'HIRED' },
];

export default function EmployerDashboard() {
  const t = useTranslations('employerDashboard');
  const locale = useLocale();
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
      <h1>{t('title')}</h1>
      <p>{t('subtitle')}</p>

      {error && <p className="error">{error}</p>}
      {loading && <p className="meta">{t('loading')}</p>}

      {!loading && summary && (
        <>
          {!summary.invitedTeam && !teamNudgeDismissed && (
            <div className="card status-card-flag" style={{ justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong>{t('inviteTitle')}</strong>
                <p className="meta" style={{ margin: 0 }}>{t('inviteBody')}</p>
              </div>
              <div className="row" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
                <Link href="/employer/settings#team">
                  <button className="btn-secondary">{t('inviteAction')}</button>
                </Link>
                <button className="btn-secondary" onClick={dismissTeamNudge}>{t('dismiss')}</button>
              </div>
            </div>
          )}

          <div className="dashboard-overview-grid">
            <Link href="/employer/jobs" className="status-card">
              <div className="status-card-label">{t('kpiActive')}</div>
              <div className="status-stat">{summary.activeJobs}</div>
              <p className="meta" style={{ margin: 0 }}>{t('kpiActiveSub')}</p>
            </Link>
            <Link href="/employer/applicants" className="status-card">
              <div className="status-card-label">{t('kpiApplicants')}</div>
              <div className="status-stat">{summary.totalApplicants}</div>
              <p className="meta" style={{ margin: 0 }}>{t('kpiApplicantsSub')}</p>
            </Link>
            <Link href="/employer/applicants" className="status-card">
              <div className="status-card-label">{t('kpiThisMonth')}</div>
              <div className="status-stat">{summary.applicantsThisMonth}</div>
              <p className="meta" style={{ margin: 0 }}>{t('kpiThisMonthSub')}</p>
            </Link>
            <div className="status-card">
              <div className="status-card-label">{t('kpiHire')}</div>
              {summary.avgTimeToHireDays !== null ? (
                <>
                  <div className="status-stat">{t('avgDays', { days: summary.avgTimeToHireDays })}</div>
                  <p className="meta" style={{ margin: 0 }}>{t('kpiHireSub')}</p>
                </>
              ) : (
                <p className="meta" style={{ margin: 0 }}>{t('kpiHireEmpty')}</p>
              )}
            </div>
          </div>

          <div className="dashboard-recent-grid">
            <section className="card" style={{ flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <h2 style={{ margin: 0 }}>{t('recentJobs')}</h2>
                <Link href="/employer/jobs">{t('viewAll')}</Link>
              </div>
              {summary.recentJobs.length === 0 ? (
                <EmptyState message={t('noJobs')} actionLabel={t('postFirstJob')} actionHref="/employer/jobs" />
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
                        <span className="meta" style={{ margin: 0 }}>{t(`jobStatus.${j.status}`)}</span>
                      </div>
                      <span className="meta" style={{ margin: 0 }}>
                        {t('jobMeta', { count: j.applicantCount, date: new Date(j.createdAt).toLocaleDateString(intlTag(locale)) })}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="card" style={{ flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <h2 style={{ margin: 0 }}>{t('recentApplicants')}</h2>
                <Link href="/employer/applicants">{t('viewAll')}</Link>
              </div>
              {summary.recentApplicants.length === 0 ? (
                <EmptyState message={t('noApplicants')} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                  {summary.recentApplicants.map((a) => (
                    <ApplicantCard
                      key={a.applicationId}
                      applicant={a}
                      compact
                      footer={
                        <Link href={`/employer/jobs?openApplicants=${a.jobId}`} className="meta" style={{ margin: 0 }}>
                          {t('appliedFor', { job: a.jobTitle })}
                        </Link>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <h2 style={{ marginTop: 32 }}>{t('pipeline')}</h2>
          <p className="meta" style={{ marginTop: -8 }}>{t('pipelineHint')}</p>

          {jobs.length > 0 && (
            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="dashboardJobFilter">{t('role')}</label>
              <select id="dashboardJobFilter" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
                <option value="">{t('allRoles')}</option>
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
                  <div className="status-card-label">{t(`stage.${card.labelKey}`)}</div>
                  <div className="status-stat">{count}</div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${(count / maxKpi) * 100}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>

          <p className="meta" style={{ marginTop: 16 }}>
            {summary.jobTitle
              ? t('pipelineSummaryForJob', { total: summary.total, job: summary.jobTitle, declined: summary.other.declined, rejected: summary.other.rejected, closed: summary.other.closed })
              : t('pipelineSummary', { total: summary.total, declined: summary.other.declined, rejected: summary.other.rejected, closed: summary.other.closed })}
          </p>
        </>
      )}
    </main>
  );
}
