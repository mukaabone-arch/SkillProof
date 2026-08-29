import { BadRequestException, ConflictException } from '@nestjs/common';
import { JobStatus, ShortlistStage } from '@prisma/client';
import { OrgsService } from './orgs.service';

const ORG_ID = 'org-1';
const ADMIN_ID = 'admin-1';

interface OrgRow {
  id: string;
  name: string;
  deactivatedAt: Date | null;
  deactivatedByUserId: string | null;
  logoKey: string | null;
}

interface JobRow {
  id: string;
  orgId: string;
  status: JobStatus;
}

/** Minimal in-memory Prisma stand-in — just enough of organization/job/application/shortlistEntry/orgMember to exercise deactivate()/previewDeactivationImpact(). */
function fakePrisma(org: OrgRow, jobs: JobRow[] = [], applications: { jobId: string; userId: string }[] = [], shortlist: { jobId: string; userId: string; stage: ShortlistStage }[] = [], members: string[] = []) {
  return {
    organization: {
      findUniqueOrThrow: jest.fn(async () => org),
      update: jest.fn(async ({ data }: { data: Partial<OrgRow> }) => {
        Object.assign(org, data);
        return { ...org };
      }),
    },
    job: {
      findMany: jest.fn(async ({ where }: { where: { orgId: string; status: JobStatus } }) =>
        jobs.filter((j) => j.orgId === where.orgId && j.status === where.status),
      ),
    },
    application: {
      findMany: jest.fn(async ({ where }: { where: { jobId: { in: string[] } } }) =>
        applications
          .filter((a) => where.jobId.in.includes(a.jobId))
          .map((a) => ({ candidateProfile: { userId: a.userId } })),
      ),
    },
    shortlistEntry: {
      findMany: jest.fn(async ({ where }: { where: { jobId: { in: string[] } } }) =>
        shortlist
          .filter((s) => where.jobId.in.includes(s.jobId) && s.stage !== ShortlistStage.HIRED)
          .map((s) => ({ candidateProfile: { userId: s.userId } })),
      ),
    },
    orgMember: {
      findMany: jest.fn(async () => members.map((userId) => ({ userId }))),
    },
  };
}

function makeService(org: OrgRow, jobs: JobRow[] = [], applications: { jobId: string; userId: string }[] = [], shortlist: { jobId: string; userId: string; stage: ShortlistStage }[] = [], members: string[] = []) {
  const prisma = fakePrisma(org, jobs, applications, shortlist, members);
  const jobsUpdate = jest.fn(async (_orgId: string, jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    if (job) job.status = JobStatus.CLOSED;
    return job;
  });
  const jobsService = { update: jobsUpdate } as never;
  const sendEmail = jest.fn(async (_userId: string, ..._rest: unknown[]) => undefined);
  const notifications = { sendEmail } as never;
  const storage = {} as never;
  const svc = new OrgsService(prisma as never, jobsService, notifications, storage);
  return { svc, prisma, jobsUpdate, sendEmail };
}

describe('OrgsService.previewDeactivationImpact', () => {
  it('returns zero counts when there are no live jobs', async () => {
    const org: OrgRow = { id: ORG_ID, name: 'Acme', deactivatedAt: null, deactivatedByUserId: null, logoKey: null };
    const { svc } = makeService(org);
    await expect(svc.previewDeactivationImpact(ORG_ID)).resolves.toEqual({ liveJobCount: 0, applicantCount: 0 });
  });

  it('dedupes a candidate who both applied and is shortlisted, and excludes HIRED', async () => {
    const org: OrgRow = { id: ORG_ID, name: 'Acme', deactivatedAt: null, deactivatedByUserId: null, logoKey: null };
    const jobs: JobRow[] = [
      { id: 'job-1', orgId: ORG_ID, status: JobStatus.LIVE },
      { id: 'job-2', orgId: ORG_ID, status: JobStatus.LIVE },
    ];
    const applications = [
      { jobId: 'job-1', userId: 'cand-1' },
      { jobId: 'job-2', userId: 'cand-2' },
    ];
    const shortlist = [
      { jobId: 'job-1', userId: 'cand-1', stage: ShortlistStage.INVITED }, // same candidate as an application above
      { jobId: 'job-2', userId: 'cand-3', stage: ShortlistStage.HIRED }, // excluded
    ];
    const { svc } = makeService(org, jobs, applications, shortlist);
    await expect(svc.previewDeactivationImpact(ORG_ID)).resolves.toEqual({ liveJobCount: 2, applicantCount: 2 });
  });
});

describe('OrgsService.deactivate', () => {
  function activeOrg(): OrgRow {
    return { id: ORG_ID, name: 'Acme Inc.', deactivatedAt: null, deactivatedByUserId: null, logoKey: null };
  }

  it('rejects a mistyped confirmation without touching anything', async () => {
    const org = activeOrg();
    const { svc, prisma } = makeService(org);
    await expect(svc.deactivate(ORG_ID, ADMIN_ID, { confirmOrgName: 'wrong name' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('rejects deactivating an already-deactivated org', async () => {
    const org: OrgRow = { ...activeOrg(), deactivatedAt: new Date() };
    const { svc } = makeService(org);
    await expect(svc.deactivate(ORG_ID, ADMIN_ID, { confirmOrgName: 'Acme Inc.' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('sets deactivatedAt/deactivatedByUserId, closes every live job via JobsService.update, and emails every member', async () => {
    const org = activeOrg();
    const jobs: JobRow[] = [
      { id: 'job-1', orgId: ORG_ID, status: JobStatus.LIVE },
      { id: 'job-2', orgId: ORG_ID, status: JobStatus.LIVE },
      { id: 'job-3', orgId: ORG_ID, status: JobStatus.DRAFT }, // not live — must not be touched
    ];
    const { svc, jobsUpdate, sendEmail } = makeService(org, jobs, [], [], ['member-1', 'member-2']);

    const result = await svc.deactivate(ORG_ID, ADMIN_ID, { confirmOrgName: 'Acme Inc.' });

    expect(org.deactivatedAt).not.toBeNull();
    expect(org.deactivatedByUserId).toBe(ADMIN_ID);
    expect(result.unpublishedJobCount).toBe(2);

    // Reused JobsService.update — never a parallel unpublish implementation.
    expect(jobsUpdate).toHaveBeenCalledWith(ORG_ID, 'job-1', { status: JobStatus.CLOSED });
    expect(jobsUpdate).toHaveBeenCalledWith(ORG_ID, 'job-2', { status: JobStatus.CLOSED });
    expect(jobsUpdate).not.toHaveBeenCalledWith(ORG_ID, 'job-3', expect.anything());

    // Every OrgMember notified, not just the triggering admin.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls.map((c) => c[0])).toEqual(['member-1', 'member-2']);
  });
});
