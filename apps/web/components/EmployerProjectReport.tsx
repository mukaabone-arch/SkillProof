'use client';

/**
 * Project report (GET /projects/:id/report): a snapshot of every role in a
 * hiring project, for sharing with leadership or, for recruiters, the
 * client. Headcount against hires, the pipeline per role, where candidates
 * came from, how many meet the verified-skill bar, and the roles that need
 * attention. No candidate names or contact details.
 *
 * Downloads: CSV (GET /projects/:id/report.csv, opens in Excel or Sheets)
 * and "Save as PDF", which prints this page with the portal's sidebar and
 * buttons hidden (print styles in globals.css), so the PDF is exactly what
 * is on screen.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi, downloadBlob } from '@/lib/api';
import { Badge } from '@/components/ui';
import HeadcountBar from './HeadcountBar';
import { dateRange, formatDate } from './EmployerProjects';

const { api, apiBlob } = employerApi;

type Attention = 'LATE' | 'NOBODY_IN_PROGRESS' | 'NOT_POSTED' | 'CLOSED_UNFILLED';

interface ReportRole {
  id: string;
  jobId: string;
  code: string;
  title: string;
  jobStatus: 'DRAFT' | 'LIVE' | 'CLOSED';
  location: string | null;
  headcount: number;
  targetStartDate: string | null;
  hired: number;
  inProgress: number;
  filled: boolean;
  applicants: number;
  stages: Record<string, number>;
  meetsVerifiedSkills: number | null;
  sources: { applied: number; sourced: number } | null;
  attention: Attention[];
}

export interface ProjectReport {
  generatedAt: string;
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    startDate: string | null;
    endDate: string | null;
    client: { id: string; name: string } | null;
    recruiter: boolean;
  };
  totals: {
    roles: number;
    headcount: number;
    hired: number;
    inProgress: number;
    openRoles: number;
    lateRoles: number;
    applicants: number;
    fillRate: number;
    meetsVerifiedSkills: number | null;
    sources: { applied: number; sourced: number } | null;
  };
  stageKeys: string[];
  stageTotals: Record<string, number>;
  roles: ReportRole[];
}

const STAGE_LABELS: Record<string, string> = {
  SHORTLISTED: 'Shortlisted',
  INVITED: 'Invited',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer',
  HIRED: 'Hired',
  DECLINED: 'Declined',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
  CANDIDATE_UNAVAILABLE: 'Unavailable',
  PENDING_CONSENT: 'Awaiting consent',
  EXPIRED: 'Consent expired',
  SUBMITTED: 'Submitted',
  PLACED: 'Placed',
  NOT_SELECTED: 'Not selected',
  WITHDRAWN: 'Withdrawn',
};

const ATTENTION: Record<Attention, { label: string; variant: 'warning' | 'neutral' }> = {
  LATE: { label: 'Start date passed', variant: 'warning' },
  NOBODY_IN_PROGRESS: { label: 'No one in progress', variant: 'warning' },
  NOT_POSTED: { label: 'Not posted', variant: 'neutral' },
  CLOSED_UNFILLED: { label: 'Closed before filled', variant: 'neutral' },
};

const JOB_STATUS: Record<ReportRole['jobStatus'], string> = { DRAFT: 'Draft', LIVE: 'Posted', CLOSED: 'Closed' };

/** The stages worth a column on screen: the forward pipeline, plus any exit stage that actually occurs. */
function visibleStages(report: ProjectReport): string[] {
  const forward = report.project.recruiter
    ? ['PENDING_CONSENT', 'SUBMITTED', 'INTERVIEWING', 'OFFER']
    : ['SHORTLISTED', 'INVITED', 'INTERVIEWING', 'OFFER'];
  // Hired / Placed already has its own column beside People needed.
  const done = report.project.recruiter ? 'PLACED' : 'HIRED';
  return report.stageKeys.filter((k) => k !== done && (forward.includes(k) || (report.stageTotals[k] ?? 0) > 0));
}

export default function EmployerProjectReport({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<ProjectReport | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api<ProjectReport>(`/projects/${projectId}/report`)
      .then(setReport)
      .catch((e) => setError((e as Error).message));
  }, [projectId]);

  async function downloadCsv() {
    if (!report) return;
    setDownloading(true);
    setError('');
    try {
      const blob = await apiBlob(`/projects/${projectId}/report.csv`);
      const slug = report.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
      downloadBlob(blob, `${slug}-report-${report.generatedAt.slice(0, 10)}.csv`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  if (error && !report) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!report) return <p className="meta">Loading report…</p>;

  const { project, totals } = report;
  const recruiter = project.recruiter;
  const stages = visibleStages(report);
  const attentionRoles = report.roles.filter((r) => r.attention.length > 0);
  const hiredWord = recruiter ? 'placed' : 'hired';

  return (
    <div className="project-report">
      <p className="meta report-actions" style={{ margin: 0 }}>
        <Link href={`/employer/projects/${project.id}`}>← {project.name}</Link>
      </p>

      <header className="project-report-head">
        <div>
          <p className="portal-headline-eyebrow">Project report</p>
          <h1>{project.name}</h1>
          <p className="meta" style={{ margin: 0 }}>
            {project.client ? `For ${project.client.name} · ` : ''}
            {dateRange(project.startDate, project.endDate)} · Generated {formatDate(report.generatedAt)}
          </p>
        </div>
        <div className="report-actions project-report-buttons">
          <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
          <button type="button" onClick={() => window.print()}>
            Save as PDF
          </button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="project-report-tiles" aria-label="Summary">
        <div className="card report-tile">
          <span className="report-tile-label">Filled</span>
          <strong>{totals.fillRate}%</strong>
          <span className="meta">
            {totals.hired} of {totals.headcount} {hiredWord}
          </span>
        </div>
        <div className="card report-tile">
          <span className="report-tile-label">In progress</span>
          <strong>{totals.inProgress}</strong>
          <span className="meta">{recruiter ? 'submitted, interviewing or at offer' : 'invited, interviewing or at offer'}</span>
        </div>
        <div className="card report-tile">
          <span className="report-tile-label">Applicants</span>
          <strong>{totals.applicants}</strong>
          <span className="meta">across {totals.roles} roles</span>
        </div>
        {recruiter ? (
          <div className="card report-tile">
            <span className="report-tile-label">Open roles</span>
            <strong>{totals.openRoles}</strong>
            <span className="meta">{totals.lateRoles} past start date</span>
          </div>
        ) : (
          <div className="card report-tile">
            <span className="report-tile-label">Meet verified skills</span>
            <strong>{totals.meetsVerifiedSkills}</strong>
            <span className="meta">candidates in the pipeline with every required skill verified</span>
          </div>
        )}
      </section>

      <section className="card project-report-section">
        <h2>Headcount</h2>
        <HeadcountBar headcount={totals.headcount} hired={totals.hired} inProgress={totals.inProgress} doneWord={hiredWord} />
      </section>

      <section className="card project-report-section">
        <h2>Roles</h2>
        <div className="project-report-scroll">
          <table className="job-import-table project-report-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Needed</th>
                <th scope="col">{recruiter ? 'Placed' : 'Hired'}</th>
                <th scope="col">Applicants</th>
                {stages.map((k) => (
                  <th scope="col" key={k}>
                    {STAGE_LABELS[k] ?? k}
                  </th>
                ))}
                {!recruiter && <th scope="col">Meet verified skills</th>}
                <th scope="col">Target start</th>
              </tr>
            </thead>
            <tbody>
              {report.roles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.title}</strong>
                    <div className="meta">
                      {r.code} · {JOB_STATUS[r.jobStatus]}
                      {r.location ? ` · ${r.location}` : ''}
                    </div>
                  </td>
                  <td data-label="Needed">{r.headcount}</td>
                  <td data-label={recruiter ? 'Placed' : 'Hired'}>
                    {r.hired}
                    {r.filled && <span className="report-filled"> ✓</span>}
                  </td>
                  <td data-label="Applicants">{r.applicants}</td>
                  {stages.map((k) => (
                    <td key={k} data-label={STAGE_LABELS[k] ?? k}>
                      {r.stages[k] ?? 0}
                    </td>
                  ))}
                  {!recruiter && <td data-label="Meet verified skills">{r.meetsVerifiedSkills}</td>}
                  <td data-label="Target start">{r.targetStartDate ? formatDate(r.targetStartDate) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td>{totals.headcount}</td>
                <td>{totals.hired}</td>
                <td>{totals.applicants}</td>
                {stages.map((k) => (
                  <td key={k}>{report.stageTotals[k] ?? 0}</td>
                ))}
                {!recruiter && <td>{totals.meetsVerifiedSkills}</td>}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="project-report-pair">
        <section className="card project-report-section">
          <h2>Needs attention</h2>
          {attentionRoles.length === 0 ? (
            <p className="meta" style={{ margin: 0 }}>
              Nothing needs attention: every role is posted and moving.
            </p>
          ) : (
            <ul className="project-report-attention">
              {attentionRoles.map((r) => (
                <li key={r.id}>
                  <strong>{r.title}</strong>
                  {r.attention.map((a) => (
                    <Badge key={a} variant={ATTENTION[a].variant}>
                      {ATTENTION[a].label}
                    </Badge>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>

        {totals.sources && (
          <section className="card project-report-section">
            <h2>Where candidates came from</h2>
            <SourceSplit applied={totals.sources.applied} sourced={totals.sources.sourced} />
          </section>
        )}
      </div>

      <p className="meta project-report-foot">
        Counts are as of {formatDate(report.generatedAt)}. No candidate names or contact details are included.
      </p>
    </div>
  );
}

function SourceSplit({ applied, sourced }: { applied: number; sourced: number }) {
  const total = applied + sourced;
  if (!total) {
    return (
      <p className="meta" style={{ margin: 0 }}>
        No candidates in the pipeline yet.
      </p>
    );
  }
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div>
      <div
        className="source-split-bar"
        role="img"
        aria-label={`${applied} applied (${pct(applied)}%), ${sourced} added from search or matches (${pct(sourced)}%)`}
      >
        <span className="source-applied" style={{ width: `${pct(applied)}%` }} />
        <span className="source-sourced" style={{ width: `${pct(sourced)}%` }} />
      </div>
      <ul className="source-split-legend">
        <li>
          <i className="source-applied" /> Applied: {applied} ({pct(applied)}%)
        </li>
        <li>
          <i className="source-sourced" /> Added from search or matches: {sourced} ({pct(sourced)}%)
        </li>
      </ul>
    </div>
  );
}
