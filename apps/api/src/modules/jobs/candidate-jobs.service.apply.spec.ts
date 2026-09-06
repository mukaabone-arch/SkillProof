import { BadRequestException } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { CandidateJobsService } from './candidate-jobs.service';

/** Minimal in-memory tables — just enough surface for apply()'s own logic, same convention as this codebase's other fake-Prisma specs. */
function fakePrisma() {
  const jobs: any[] = [];
  const profiles: any[] = [];
  const applications: any[] = [];

  return {
    _jobs: jobs,
    _profiles: profiles,
    job: {
      findUnique: jest.fn(async ({ where }: any) => jobs.find((j) => j.id === where.id) ?? null),
    },
    candidateProfile: {
      findUnique: jest.fn(async ({ where }: any) => profiles.find((p) => p.userId === where.userId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `profile-${profiles.length + 1}`,
          userId: data.userId,
          fullName: null,
          headline: null,
          yearsOfExp: null,
          aiYearsOfExp: null,
          resumeS3Key: null,
          ...data,
        };
        profiles.push(row);
        return row;
      }),
    },
    application: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `app-${applications.length + 1}`, ...data };
        applications.push(row);
        return row;
      }),
    },
    skillClaim: { count: jest.fn(async () => 0) },
    externalCredential: { count: jest.fn(async () => 0) },
    certification: { count: jest.fn(async () => 0) },
  };
}

function readyProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'user-1',
    id: 'profile-1',
    fullName: 'Ada Lovelace',
    headline: 'Backend engineer',
    yearsOfExp: 5,
    aiYearsOfExp: 2,
    resumeS3Key: 'resumes/profile-1.pdf',
    ...overrides,
  };
}

function makeService(profileOverrides: Partial<Record<string, unknown>> = {}) {
  const prisma = fakePrisma();
  prisma._jobs.push({
    id: 'job-1',
    status: JobStatus.LIVE,
    title: 'Backend Engineer',
    organization: { name: 'Acme' },
  });
  prisma._profiles.push(readyProfile(profileOverrides));
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const service = new CandidateJobsService(prisma as any, notifications as any);
  return { service, prisma };
}

async function applyAndCaptureCode(service: CandidateJobsService): Promise<string | undefined> {
  try {
    await service.apply('user-1', 'job-1');
    return undefined;
  } catch (err) {
    const response = (err as BadRequestException).getResponse() as { code?: string };
    return response.code;
  }
}

describe('CandidateJobsService.apply — resume and AI-experience gate', () => {
  it('succeeds when name, headline, resume, and aiYearsOfExp are all present', async () => {
    const { service } = makeService();
    const app = await service.apply('user-1', 'job-1');
    expect(app.id).toBeDefined();
  });

  it('rejects with RESUME_REQUIRED when resumeS3Key is null', async () => {
    const { service } = makeService({ resumeS3Key: null });
    await expect(applyAndCaptureCode(service)).resolves.toBe('RESUME_REQUIRED');
  });

  it('rejects with AI_EXPERIENCE_REQUIRED when aiYearsOfExp is null (never provided)', async () => {
    const { service } = makeService({ aiYearsOfExp: null });
    await expect(applyAndCaptureCode(service)).resolves.toBe('AI_EXPERIENCE_REQUIRED');
  });

  it('accepts aiYearsOfExp: 0 — a candidate genuinely new to AI must not be blocked', async () => {
    const { service } = makeService({ aiYearsOfExp: 0 });
    const app = await service.apply('user-1', 'job-1');
    expect(app.id).toBeDefined();
  });

  it('still enforces the pre-existing PROFILE_INCOMPLETE check ahead of the new checks', async () => {
    const { service } = makeService({ fullName: null, headline: null, yearsOfExp: null });
    await expect(applyAndCaptureCode(service)).resolves.toBe('PROFILE_INCOMPLETE');
  });
});
