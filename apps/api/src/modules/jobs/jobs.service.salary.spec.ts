import { EmploymentType, JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service';
import { CreateJobDto, UpdateJobDto } from './jobs.dto';

/** Minimal in-memory Job table — just enough surface for create/update's own logic, same convention as this codebase's other fake-Prisma specs. */
function fakePrisma() {
  const jobs: any[] = [];
  let nextId = 1;

  return {
    _jobs: jobs,
    job: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `job-${nextId++}`, createdAt: new Date(), updatedAt: new Date(), status: JobStatus.DRAFT, ...data };
        jobs.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => jobs.find((j) => j.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = jobs.find((j) => j.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    notification: { findMany: jest.fn(async () => []) },
    application: { findMany: jest.fn(async () => []) },
    shortlistEntry: { findMany: jest.fn(async () => []) },
  };
}

function baseDto(overrides: Partial<CreateJobDto> = {}): CreateJobDto {
  return {
    title: 'Backend Engineer',
    code: 'BE-01',
    description: 'A'.repeat(30),
    employmentType: EmploymentType.FULL_TIME,
    ...overrides,
  } as CreateJobDto;
}

function makeService() {
  const prisma = fakePrisma();
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const service = new JobsService(prisma as any, {} as any, {} as any, {} as any, notifications as any);
  return { service, prisma };
}

describe('JobsService — salary shape validation', () => {
  describe('create', () => {
    it('accepts a job with no salary info at all — the ordinary "not filled in" case', async () => {
      const { service } = makeService();
      const job = await service.create('org-1', baseDto());
      expect(job.salaryMin).toBeUndefined();
    });

    it('accepts salaryNotDisclosed: true with no min/max', async () => {
      const { service } = makeService();
      const job = await service.create('org-1', baseDto({ salaryNotDisclosed: true }));
      expect(job.salaryNotDisclosed).toBe(true);
    });

    it('rejects salaryNotDisclosed: true together with a salaryMin', async () => {
      const { service } = makeService();
      await expect(service.create('org-1', baseDto({ salaryNotDisclosed: true, salaryMin: 100000 }))).rejects.toThrow(
        /must not be set when salaryNotDisclosed is true/,
      );
    });

    it('accepts a valid salaryMin/salaryMax range', async () => {
      const { service } = makeService();
      const job = await service.create('org-1', baseDto({ salaryMin: 1_000_000_00, salaryMax: 2_000_000_00 }));
      expect(job.salaryMin).toBe(1_000_000_00);
      expect(job.salaryMax).toBe(2_000_000_00);
    });

    it('rejects a lone salaryMin with no salaryMax', async () => {
      const { service } = makeService();
      await expect(service.create('org-1', baseDto({ salaryMin: 1_000_000_00 }))).rejects.toThrow(/must be set together/);
    });

    it('rejects a lone salaryMax with no salaryMin', async () => {
      const { service } = makeService();
      await expect(service.create('org-1', baseDto({ salaryMax: 1_000_000_00 }))).rejects.toThrow(/must be set together/);
    });

    it('rejects salaryMin greater than salaryMax', async () => {
      const { service } = makeService();
      await expect(service.create('org-1', baseDto({ salaryMin: 2_000_000_00, salaryMax: 1_000_000_00 }))).rejects.toThrow(
        /must not be greater than/,
      );
    });

    it('accepts salaryMin === salaryMax (a fixed, non-range figure)', async () => {
      const { service } = makeService();
      const job = await service.create('org-1', baseDto({ salaryMin: 1_500_000_00, salaryMax: 1_500_000_00 }));
      expect(job.salaryMin).toBe(job.salaryMax);
    });
  });

  describe('update — validates the RESULTING combination against the existing row, not the patch alone', () => {
    async function createDraft(prisma: any, overrides: Partial<UpdateJobDto> = {}) {
      const row = {
        id: 'job-1',
        orgId: 'org-1',
        status: JobStatus.DRAFT,
        salaryMin: null,
        salaryMax: null,
        salaryNotDisclosed: false,
        ...overrides,
      };
      prisma._jobs.push(row);
      return row;
    }

    it('a PATCH that only sets salaryMin, against a job with no existing salaryMax, is rejected — not silently half-applied', async () => {
      const { service, prisma } = makeService();
      await createDraft(prisma);
      await expect(service.update('org-1', 'job-1', { salaryMin: 1_000_000_00 } as UpdateJobDto)).rejects.toThrow(
        /must be set together/,
      );
    });

    it('a PATCH that sets salaryMin where the job already has a salaryMax is accepted — validated against the merged result', async () => {
      const { service, prisma } = makeService();
      await createDraft(prisma, { salaryMax: 2_000_000_00 });
      const updated = await service.update('org-1', 'job-1', { salaryMin: 1_000_000_00 } as UpdateJobDto);
      expect(updated.salaryMin).toBe(1_000_000_00);
      expect(updated.salaryMax).toBe(2_000_000_00);
    });

    it('flipping salaryNotDisclosed to true WITHOUT clearing pre-existing amounts is rejected', async () => {
      const { service, prisma } = makeService();
      await createDraft(prisma, { salaryMin: 1_000_000_00, salaryMax: 2_000_000_00 });
      await expect(service.update('org-1', 'job-1', { salaryNotDisclosed: true } as UpdateJobDto)).rejects.toThrow(
        /must not be set when salaryNotDisclosed is true/,
      );
    });

    it('flipping salaryNotDisclosed to true WHILE explicitly clearing both amounts (null) is accepted', async () => {
      const { service, prisma } = makeService();
      await createDraft(prisma, { salaryMin: 1_000_000_00, salaryMax: 2_000_000_00 });
      const updated = await service.update('org-1', 'job-1', {
        salaryNotDisclosed: true,
        salaryMin: null,
        salaryMax: null,
      } as UpdateJobDto);
      expect(updated.salaryNotDisclosed).toBe(true);
      expect(updated.salaryMin).toBeNull();
      expect(updated.salaryMax).toBeNull();
    });

    it('a PATCH touching an unrelated field leaves an already-valid salary combination alone', async () => {
      const { service, prisma } = makeService();
      await createDraft(prisma, { salaryMin: 1_000_000_00, salaryMax: 2_000_000_00, title: 'Old title' });
      const updated = await service.update('org-1', 'job-1', { title: 'New title' } as UpdateJobDto);
      expect(updated.salaryMin).toBe(1_000_000_00);
      expect(updated.salaryMax).toBe(2_000_000_00);
    });
  });
});
