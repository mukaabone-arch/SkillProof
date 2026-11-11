import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HiringProjectStatus, JobStatus, Prisma, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JobImportService } from '../jobs/import/job-import.service';
import { ProjectsService } from './projects.service';

const PAST = new Date('2020-01-01T00:00:00Z');
const FUTURE = new Date('2099-01-01T00:00:00Z');

function job(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    code: id.toUpperCase(),
    title: `Role ${id}`,
    status: JobStatus.LIVE,
    remote: false,
    locationCity: 'Pune',
    locationRegion: 'Maharashtra',
    locationCountry: 'IN',
    locationLegacy: null,
    skills: [{ isRequired: true }],
    ...over,
  };
}

function setup() {
  const groups = [
    { jobId: 'j1', stage: ShortlistStage.HIRED, _count: { _all: 2 } },
    { jobId: 'j1', stage: ShortlistStage.INTERVIEWING, _count: { _all: 3 } },
    { jobId: 'j1', stage: ShortlistStage.OFFER, _count: { _all: 1 } },
    { jobId: 'j2', stage: ShortlistStage.HIRED, _count: { _all: 4 } },
  ];
  const prisma = {
    hiringProject: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      update: jest.fn(async ({ data }: { data: unknown }) => data),
    },
    projectRole: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(async () => ({ _max: { sortOrder: 2 } })),
    },
    job: { findFirst: jest.fn(async () => ({ id: 'j9' })) },
    shortlistEntry: { groupBy: jest.fn(async () => groups) },
  };
  const jobImport = { publish: jest.fn(async (_o: string, ids: string[]) => ({ published: ids, skipped: [] })) };
  const svc = new ProjectsService(prisma as unknown as PrismaService, jobImport as unknown as JobImportService);
  return { svc, prisma, jobImport };
}

describe('ProjectsService', () => {
  it('counts hired and in-progress per role from the pipeline, and flags late and filled roles', async () => {
    const { svc, prisma } = setup();
    prisma.hiringProject.findFirst.mockResolvedValue({
      id: 'p1',
      orgId: 'o1',
      name: 'Support AI rollout',
      roles: [
        { id: 'r1', jobId: 'j1', headcount: 5, targetStartDate: PAST, sortOrder: 0, job: job('j1') },
        { id: 'r2', jobId: 'j2', headcount: 3, targetStartDate: FUTURE, sortOrder: 1, job: job('j2') },
        { id: 'r3', jobId: 'j3', headcount: 1, targetStartDate: null, sortOrder: 2, job: job('j3', { status: JobStatus.DRAFT, skills: [], remote: true, locationCity: null }) },
      ],
    });

    const p = await svc.get('o1', 'p1');
    expect(p.roles.map((r) => [r.id, r.hired, r.inProgress, r.filled, r.late])).toEqual([
      ['r1', 2, 4, false, true],
      ['r2', 4, 0, true, false],
      ['r3', 0, 0, false, false],
    ]);
    expect(p.roles[2].blockers).toEqual(['Add at least one required skill.']);
    expect(p.roles[2].location).toBe('Remote');
    // Over-hiring r2 (4 of 3) doesn't count beyond its headcount.
    expect(p).toMatchObject({ headcount: 9, hired: 5, inProgress: 4, openRoles: 2 });
  });

  it('404s on another org’s project', async () => {
    const { svc, prisma } = setup();
    prisma.hiringProject.findFirst.mockResolvedValue(null);
    await expect(svc.get('o1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists projects with totals, open and late roles', async () => {
    const { svc, prisma } = setup();
    prisma.hiringProject.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'A',
        description: null,
        startDate: null,
        endDate: null,
        status: HiringProjectStatus.ACTIVE,
        roles: [
          { jobId: 'j1', headcount: 5, targetStartDate: PAST, job: { status: JobStatus.LIVE } },
          { jobId: 'j2', headcount: 3, targetStartDate: null, job: { status: JobStatus.LIVE } },
        ],
      },
    ]);
    const [p] = await svc.list('o1');
    expect(p).toMatchObject({ roleCount: 2, headcount: 8, hired: 5, inProgress: 4, openRoles: 1, lateRoles: 1 });
    expect(prisma.hiringProject.findMany.mock.calls[0][0].where).toEqual({ orgId: 'o1', status: { not: HiringProjectStatus.ARCHIVED } });
  });

  it('rejects an end date before the start date', async () => {
    const { svc } = setup();
    await expect(svc.create('o1', 'u1', { name: 'X', startDate: '2027-03-01', endDate: '2027-01-01' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('adds a role at the end of the list, and refuses a job already in a project', async () => {
    const { svc, prisma } = setup();
    prisma.hiringProject.findFirst.mockResolvedValue({ id: 'p1', status: HiringProjectStatus.ACTIVE });
    const role = await svc.addRole('o1', 'p1', { jobId: 'j9', headcount: 2 });
    expect(role).toMatchObject({ projectId: 'p1', jobId: 'j9', headcount: 2, sortOrder: 3 });

    prisma.projectRole.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(svc.addRole('o1', 'p1', { jobId: 'j9', headcount: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('only adds jobs from the same org, and not to an archived project', async () => {
    const { svc, prisma } = setup();
    prisma.hiringProject.findFirst.mockResolvedValue({ id: 'p1', status: HiringProjectStatus.ACTIVE });
    prisma.job.findFirst.mockResolvedValueOnce(null as never);
    await expect(svc.addRole('o1', 'p1', { jobId: 'other-org', headcount: 1 })).rejects.toBeInstanceOf(NotFoundException);

    prisma.hiringProject.findFirst.mockResolvedValue({ id: 'p1', status: HiringProjectStatus.ARCHIVED });
    await expect(svc.addRole('o1', 'p1', { jobId: 'j9', headcount: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('posts only the project’s draft roles, through the bulk-import publish rules', async () => {
    const { svc, prisma, jobImport } = setup();
    prisma.hiringProject.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.projectRole.findMany.mockResolvedValue([{ jobId: 'j3' }, { jobId: 'j4' }]);
    const res = await svc.publishReady('o1', 'p1');
    expect(prisma.projectRole.findMany.mock.calls[0][0].where).toEqual({ projectId: 'p1', job: { status: JobStatus.DRAFT } });
    expect(jobImport.publish).toHaveBeenCalledWith('o1', ['j3', 'j4']);
    expect(res.published).toEqual(['j3', 'j4']);
  });

  it('removes a role without touching its job', async () => {
    const { svc, prisma } = setup();
    prisma.projectRole.findFirst.mockResolvedValue({ id: 'r1' });
    await svc.removeRole('o1', 'p1', 'r1');
    expect(prisma.projectRole.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });
});
