import { Injectable } from '@nestjs/common';
import { ClaimStatus, JobStatus, ShortlistStage, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { effectiveSubmissionStatus } from '../staffing/staffing-representation.util';
import { ProjectsService } from './projects.service';

/** Employer pipeline stages shown in the report, in pipeline order. */
export const EMPLOYER_STAGES = [
  ShortlistStage.SHORTLISTED,
  ShortlistStage.INVITED,
  ShortlistStage.INTERVIEWING,
  ShortlistStage.OFFER,
  ShortlistStage.HIRED,
  ShortlistStage.DECLINED,
  ShortlistStage.REJECTED,
  ShortlistStage.CLOSED,
  ShortlistStage.CANDIDATE_UNAVAILABLE,
] as const;

/** Recruiter submission statuses shown in the report (EXPIRED = consent ran out). */
export const RECRUITER_STAGES = [
  'PENDING_CONSENT',
  'SUBMITTED',
  'INTERVIEWING',
  'OFFER',
  'PLACED',
  'EXPIRED',
  'DECLINED',
  'NOT_SELECTED',
  'WITHDRAWN',
] as const;

/** Stages where a candidate is still in play for the role (employer side). */
const ACTIVE_STAGES: ShortlistStage[] = [
  ShortlistStage.SHORTLISTED,
  ShortlistStage.INVITED,
  ShortlistStage.INTERVIEWING,
  ShortlistStage.OFFER,
  ShortlistStage.HIRED,
];

const LEVEL_RANK: Record<SkillLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

export type Attention = 'LATE' | 'NOBODY_IN_PROGRESS' | 'NOT_POSTED' | 'CLOSED_UNFILLED';

export interface ReportRole {
  id: string;
  jobId: string;
  code: string;
  title: string;
  jobStatus: JobStatus;
  location: string | null;
  headcount: number;
  targetStartDate: Date | null;
  hired: number;
  inProgress: number;
  filled: boolean;
  applicants: number;
  stages: Record<string, number>;
  /** Employer only: candidates in the pipeline who hold every required skill, verified, at the required level. */
  meetsVerifiedSkills: number | null;
  /** Employer only: pipeline candidates who applied, said Interested to AI sourcing, or were added from search or matches. */
  sources: { applied: number; aiSourced: number; sourced: number } | null;
  attention: Attention[];
}

/**
 * Project report (hiring projects, step 1): one snapshot of every role,
 * built from data the platform already keeps. Employer projects count
 * applications and the shortlist pipeline; recruiter projects count the
 * submissions put forward to the client. No candidate names or contact
 * details: the report is for sharing with leadership or a client.
 * Time-based figures (time to fill, trends) need a stage history and come
 * in a later step.
 */
@Injectable()
export class ProjectReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async build(orgId: string, projectId: string, now = new Date()) {
    const project = await this.projects.get(orgId, projectId);
    const jobIds = project.roles.map((r) => r.jobId);
    const recruiter = project.recruiter;

    const appGroups = jobIds.length
      ? await this.prisma.application.groupBy({ by: ['jobId'], where: { jobId: { in: jobIds } }, _count: { _all: true } })
      : [];
    const applicantsByJob = new Map(appGroups.map((g) => [g.jobId, g._count._all]));

    const extra = recruiter ? await this.recruiterDetail(project.roles.map((r) => r.id), now) : await this.employerDetail(jobIds);

    const roles: ReportRole[] = project.roles.map((r) => {
      const d = extra.get(recruiter ? r.id : r.jobId);
      const stages = d?.stages ?? {};
      const attention: Attention[] = [];
      if (r.late) attention.push('LATE');
      if (r.jobStatus === JobStatus.DRAFT) attention.push('NOT_POSTED');
      else if (r.jobStatus === JobStatus.CLOSED && !r.filled) attention.push('CLOSED_UNFILLED');
      else if (!r.filled && r.inProgress === 0) attention.push('NOBODY_IN_PROGRESS');
      return {
        id: r.id,
        jobId: r.jobId,
        code: r.code,
        title: r.title,
        jobStatus: r.jobStatus,
        location: r.location,
        headcount: r.headcount,
        targetStartDate: r.targetStartDate,
        hired: r.hired,
        inProgress: r.inProgress,
        filled: r.filled,
        applicants: applicantsByJob.get(r.jobId) ?? 0,
        stages,
        meetsVerifiedSkills: recruiter ? null : d?.meetsVerifiedSkills ?? 0,
        sources: recruiter ? null : d?.sources ?? { applied: 0, aiSourced: 0, sourced: 0 },
        attention,
      };
    });

    const stageKeys: readonly string[] = recruiter ? RECRUITER_STAGES : EMPLOYER_STAGES;
    const stageTotals = Object.fromEntries(stageKeys.map((k) => [k, roles.reduce((a, r) => a + (r.stages[k] ?? 0), 0)]));

    return {
      generatedAt: now,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        client: project.client ?? null,
        recruiter,
      },
      totals: {
        roles: roles.length,
        headcount: project.headcount,
        hired: project.hired,
        inProgress: project.inProgress,
        openRoles: project.openRoles,
        lateRoles: roles.filter((r) => r.attention.includes('LATE')).length,
        applicants: roles.reduce((a, r) => a + r.applicants, 0),
        fillRate: project.headcount ? Math.round((project.hired / project.headcount) * 100) : 0,
        meetsVerifiedSkills: recruiter ? null : roles.reduce((a, r) => a + (r.meetsVerifiedSkills ?? 0), 0),
        sources: recruiter
          ? null
          : {
              applied: roles.reduce((a, r) => a + (r.sources?.applied ?? 0), 0),
              aiSourced: roles.reduce((a, r) => a + (r.sources?.aiSourced ?? 0), 0),
              sourced: roles.reduce((a, r) => a + (r.sources?.sourced ?? 0), 0),
            },
      },
      stageKeys,
      stageTotals,
      roles,
    };
  }

  /** Per job: shortlist stage counts, where candidates came from, and how many meet the verified-skill bar. */
  private async employerDetail(jobIds: string[]) {
    const out = new Map<string, { stages: Record<string, number>; sources: { applied: number; aiSourced: number; sourced: number }; meetsVerifiedSkills: number }>();
    if (!jobIds.length) return out;
    const [entries, apps, jobs] = await Promise.all([
      this.prisma.shortlistEntry.findMany({ where: { jobId: { in: jobIds } }, select: { id: true, jobId: true, candidateId: true, stage: true } }),
      this.prisma.application.findMany({ where: { jobId: { in: jobIds } }, select: { jobId: true, candidateProfileId: true } }),
      this.prisma.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, skills: { where: { isRequired: true }, select: { skillId: true, requiredLevel: true } } },
      }),
    ]);
    const applied = new Set(apps.map((a) => `${a.jobId}:${a.candidateProfileId}`));
    const active = entries.filter((e) => ACTIVE_STAGES.includes(e.stage));
    const candidateIds = Array.from(new Set(active.map((e) => e.candidateId)));
    const fromOutreach = active.length
      ? new Set(
          (
            await this.prisma.outreachMessage.findMany({
              where: { shortlistEntryId: { in: active.map((e) => e.id) } },
              select: { shortlistEntryId: true },
            })
          ).map((m) => m.shortlistEntryId),
        )
      : new Set<string | null>();
    const skillIds = Array.from(new Set(jobs.flatMap((j) => j.skills.map((s) => s.skillId))));
    const claims =
      candidateIds.length && skillIds.length
        ? await this.prisma.skillClaim.findMany({
            where: { profileId: { in: candidateIds }, skillId: { in: skillIds }, status: ClaimStatus.VERIFIED },
            select: { profileId: true, skillId: true, level: true },
          })
        : [];
    const levelOf = new Map(claims.map((c) => [`${c.profileId}:${c.skillId}`, LEVEL_RANK[c.level]]));
    const required = new Map(jobs.map((j) => [j.id, j.skills]));

    for (const jobId of jobIds) out.set(jobId, { stages: {}, sources: { applied: 0, aiSourced: 0, sourced: 0 }, meetsVerifiedSkills: 0 });
    for (const e of entries) {
      if (!e.jobId) continue;
      const d = out.get(e.jobId)!;
      d.stages[e.stage] = (d.stages[e.stage] ?? 0) + 1;
    }
    for (const e of active) {
      if (!e.jobId) continue;
      const d = out.get(e.jobId)!;
      if (applied.has(`${e.jobId}:${e.candidateId}`)) d.sources.applied++;
      else if (fromOutreach.has(e.id)) d.sources.aiSourced++;
      else d.sources.sourced++;
      const req = required.get(e.jobId) ?? [];
      if (req.length && req.every((s) => (levelOf.get(`${e.candidateId}:${s.skillId}`) ?? 0) >= LEVEL_RANK[s.requiredLevel])) {
        d.meetsVerifiedSkills++;
      }
    }
    return out;
  }

  /** Per project role: submission status counts (consent that ran out shows as EXPIRED). */
  private async recruiterDetail(roleIds: string[], now: Date) {
    const out = new Map<string, { stages: Record<string, number>; sources: null; meetsVerifiedSkills: null }>();
    if (!roleIds.length) return out;
    const subs = await this.prisma.staffingSubmission.findMany({
      where: { projectRoleId: { in: roleIds } },
      select: { projectRoleId: true, status: true, consentExpiresAt: true },
    });
    for (const id of roleIds) out.set(id, { stages: {}, sources: null, meetsVerifiedSkills: null });
    for (const s of subs) {
      if (!s.projectRoleId) continue;
      const st = effectiveSubmissionStatus(s, now);
      const d = out.get(s.projectRoleId)!;
      d.stages[st] = (d.stages[st] ?? 0) + 1;
    }
    return out;
  }
}

/** Plain-English column names, shared by the CSV and the web page. */
export const STAGE_LABELS: Record<string, string> = {
  SHORTLISTED: 'Shortlisted',
  INVITED: 'Invited',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer',
  HIRED: 'Hired',
  DECLINED: 'Declined',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
  CANDIDATE_UNAVAILABLE: 'Candidate unavailable',
  PENDING_CONSENT: 'Awaiting consent',
  EXPIRED: 'Consent expired',
  SUBMITTED: 'Submitted',
  PLACED: 'Placed',
  NOT_SELECTED: 'Not selected',
  WITHDRAWN: 'Withdrawn',
};

export const ATTENTION_LABELS: Record<Attention, string> = {
  LATE: 'Start date passed',
  NOBODY_IN_PROGRESS: 'No one in progress',
  NOT_POSTED: 'Not posted',
  CLOSED_UNFILLED: 'Closed before filled',
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  // Guard against spreadsheet formula injection from user-entered titles.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per role, plus a totals row: opens straight in Excel or Google Sheets. */
export function reportToCsv(report: Awaited<ReturnType<ProjectReportService['build']>>): string {
  const recruiter = report.project.recruiter;
  const header = [
    'Role',
    'Job code',
    'Job status',
    'Location',
    'People needed',
    'Target start',
    recruiter ? 'Placed' : 'Hired',
    'In progress',
    'Applicants',
    ...report.stageKeys.map((k) => STAGE_LABELS[k] ?? k),
    ...(recruiter ? [] : ['Meet all required verified skills', 'Applied', 'Sourced by AI', 'Added from search or matches']),
    'Needs attention',
  ];
  const rows = report.roles.map((r) => [
    r.title,
    r.code,
    r.jobStatus,
    r.location,
    r.headcount,
    r.targetStartDate,
    r.hired,
    r.inProgress,
    r.applicants,
    ...report.stageKeys.map((k) => r.stages[k] ?? 0),
    ...(recruiter ? [] : [r.meetsVerifiedSkills, r.sources?.applied, r.sources?.aiSourced, r.sources?.sourced]),
    r.attention.map((a) => ATTENTION_LABELS[a]).join('; '),
  ]);
  const t = report.totals;
  const totals = [
    'Total',
    '',
    '',
    '',
    t.headcount,
    '',
    t.hired,
    t.inProgress,
    t.applicants,
    ...report.stageKeys.map((k) => report.stageTotals[k] ?? 0),
    ...(recruiter ? [] : [t.meetsVerifiedSkills, t.sources?.applied, t.sources?.aiSourced, t.sources?.sourced]),
    `${t.lateRoles} past start date`,
  ];
  return [header, ...rows, totals].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
