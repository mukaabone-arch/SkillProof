import { ClaimStatus, JobStatus, ShortlistStage, StaffingSubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectReportService, reportToCsv } from './project-report.service';
import { ProjectsService } from './projects.service';

const role = (over: Record<string, unknown>) => ({
  id: 'r1', jobId: 'j1', code: 'AI-1', title: 'ML Engineer', jobStatus: JobStatus.LIVE, location: 'Pune', headcount: 3,
  targetStartDate: null, sortOrder: 0, hired: 1, inProgress: 2, filled: false, late: false, blockers: [], ...over,
});

function setup(project: Record<string, unknown>) {
  const prisma = {
    application: {
      groupBy: jest.fn(async () => [{ jobId: 'j1', _count: { _all: 5 } }]),
      findMany: jest.fn(async () => [{ jobId: 'j1', candidateProfileId: 'c1' }]),
    },
    shortlistEntry: {
      findMany: jest.fn(async () => [
        { jobId: 'j1', candidateId: 'c1', stage: ShortlistStage.HIRED },
        { jobId: 'j1', candidateId: 'c2', stage: ShortlistStage.INTERVIEWING },
        { jobId: 'j1', candidateId: 'c3', stage: ShortlistStage.REJECTED },
      ]),
    },
    job: { findMany: jest.fn(async () => [{ id: 'j1', skills: [{ skillId: 's1', requiredLevel: 'L2' }] }]) },
    skillClaim: {
      findMany: jest.fn(async () => [
        { profileId: 'c1', skillId: 's1', level: 'L3' },
        { profileId: 'c2', skillId: 's1', level: 'L1' },
      ]),
    },
    staffingSubmission: {
      findMany: jest.fn(async () => [
        { projectRoleId: 'r1', status: StaffingSubmissionStatus.PLACED, consentExpiresAt: new Date('2026-01-01') },
        { projectRoleId: 'r1', status: StaffingSubmissionStatus.PENDING_CONSENT, consentExpiresAt: new Date('2026-01-01') },
        { projectRoleId: 'r1', status: StaffingSubmissionStatus.PENDING_CONSENT, consentExpiresAt: new Date('2099-01-01') },
      ]),
    },
  };
  const projects = { get: jest.fn(async () => project) };
  const svc = new ProjectReportService(prisma as unknown as PrismaService, projects as unknown as ProjectsService);
  return { svc, prisma };
}

const base = { id: 'p1', name: 'Support AI rollout', description: null, status: 'ACTIVE', startDate: null, endDate: null, headcount: 3, hired: 1, inProgress: 2, openRoles: 1 };
const NOW = new Date('2026-11-17T00:00:00Z');

describe('ProjectReportService', () => {
  it('employer: counts stages, sources, and who meets the verified-skill bar', async () => {
    const { svc, prisma } = setup({ ...base, recruiter: false, client: null, roles: [role({})] });
    const r = await svc.build('o1', 'p1', NOW);
    const row = r.roles[0];
    expect(row.applicants).toBe(5);
    expect(row.stages).toMatchObject({ HIRED: 1, INTERVIEWING: 1, REJECTED: 1 });
    // c1 applied, c2 was added from search; the rejected candidate is not counted.
    expect(row.sources).toEqual({ applied: 1, sourced: 1 });
    // Only c1 holds the required skill at Practitioner or above, verified.
    expect(row.meetsVerifiedSkills).toBe(1);
    expect((prisma.skillClaim.findMany.mock.calls as unknown as [{ where: { status: string } }][])[0][0].where.status).toBe(ClaimStatus.VERIFIED);
    expect(r.totals).toMatchObject({ fillRate: 33, applicants: 5 });
  });

  it('recruiter: counts submissions per role, with expired consent split out', async () => {
    const { svc } = setup({ ...base, recruiter: true, client: { id: 'c1', name: 'Globex' }, roles: [role({})] });
    const r = await svc.build('o1', 'p1', NOW);
    expect(r.roles[0].stages).toEqual({ PLACED: 1, EXPIRED: 1, PENDING_CONSENT: 1 });
    expect(r.roles[0].meetsVerifiedSkills).toBeNull();
    expect(r.project.client).toEqual({ id: 'c1', name: 'Globex' });
  });

  it('flags roles that need attention', async () => {
    const { svc } = setup({
      ...base,
      recruiter: false,
      client: null,
      roles: [
        role({ id: 'a', late: true }),
        role({ id: 'b', jobId: 'j2', inProgress: 0 }),
        role({ id: 'c', jobId: 'j3', jobStatus: JobStatus.DRAFT, inProgress: 0 }),
        role({ id: 'd', jobId: 'j4', jobStatus: JobStatus.CLOSED, inProgress: 0 }),
      ],
    });
    const r = await svc.build('o1', 'p1', NOW);
    expect(r.roles.map((x) => x.attention)).toEqual([['LATE'], ['NOBODY_IN_PROGRESS'], ['NOT_POSTED'], ['CLOSED_UNFILLED']]);
  });

  it('writes a CSV with a header, one row per role, a totals row, and no formula injection', async () => {
    const { svc } = setup({ ...base, recruiter: false, client: null, roles: [role({ title: '=HYPERLINK("x")', code: 'A,1' })] });
    const csv = reportToCsv(await svc.build('o1', 'p1', NOW));
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Meet all required verified skills');
    expect(lines[1].startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(lines[1]).toContain('"A,1"');
    expect(lines[2].startsWith('Total')).toBe(true);
  });
});
