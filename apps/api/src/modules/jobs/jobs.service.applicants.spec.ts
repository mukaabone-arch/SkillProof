import { JobsService } from './jobs.service';

/**
 * Minimal fake Prisma covering only what JobsService.getApplicants touches:
 * getOwnedJob's job.findUnique, applicantsFor's job.findUniqueOrThrow, and
 * application.findMany. Same convention as jobs.service.salary.spec.ts.
 */
function fakePrisma(opts: { job: { id: string; orgId: string }; applications: any[] }) {
  return {
    job: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === opts.job.id ? { ...opts.job } : null)),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const job = where.id === opts.job.id ? opts.job : null;
        if (!job) throw new Error('not found');
        return { ...job, skills: [], experienceMin: null, experienceMax: null };
      }),
    },
    application: {
      findMany: jest.fn(async () => opts.applications),
    },
  };
}

function baseCandidateProfile(overrides: any = {}) {
  return {
    id: 'cand-1',
    fullName: 'Ada Lovelace',
    headline: 'Backend engineer',
    roleTitle: null,
    roleTitleOther: null,
    yearsOfExp: 5,
    githubUrl: null,
    linkedinUrl: null,
    photoKey: null,
    resumeS3Key: null,
    locationCity: null,
    locationRegion: null,
    locationCountry: null,
    locationLegacy: null,
    skillClaims: [],
    externalCredentials: [],
    certifications: [],
    portfolio: null,
    ...overrides,
  };
}

function baseApplication(overrides: any = {}) {
  return {
    id: 'app-1',
    status: 'APPLIED',
    createdAt: new Date(),
    job: { id: 'job-1', title: 'Backend Engineer', code: 'BE-01' },
    candidateProfile: baseCandidateProfile(),
    ...overrides,
  };
}

function makeService(prisma: any) {
  return new JobsService(prisma, {} as any, {} as any, {} as any, {} as any);
}

describe('JobsService.getApplicants — hasPortfolio', () => {
  it('a candidate with no CandidatePortfolio row → no link (hasPortfolio false)', async () => {
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1' },
      applications: [baseApplication({ candidateProfile: baseCandidateProfile({ portfolio: null }) })],
    });
    const service = makeService(prisma);

    const [applicant] = await service.getApplicants('org-1', 'job-1');
    expect(applicant.hasPortfolio).toBe(false);
  });

  it('approvedAt null → no link, even though the row exists', async () => {
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1' },
      applications: [
        baseApplication({
          candidateProfile: baseCandidateProfile({ portfolio: { approvedAt: null, visibleToEmployers: true } }),
        }),
      ],
    });
    const service = makeService(prisma);

    const [applicant] = await service.getApplicants('org-1', 'job-1');
    expect(applicant.hasPortfolio).toBe(false);
  });

  it('visibleToEmployers false → no link, even though approvedAt is set', async () => {
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1' },
      applications: [
        baseApplication({
          candidateProfile: baseCandidateProfile({
            portfolio: { approvedAt: new Date(), visibleToEmployers: false },
          }),
        }),
      ],
    });
    const service = makeService(prisma);

    const [applicant] = await service.getApplicants('org-1', 'job-1');
    expect(applicant.hasPortfolio).toBe(false);
  });

  it('both approvedAt and visibleToEmployers set → link rendered (hasPortfolio true)', async () => {
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1' },
      applications: [
        baseApplication({
          candidateProfile: baseCandidateProfile({
            portfolio: { approvedAt: new Date(), visibleToEmployers: true },
          }),
        }),
      ],
    });
    const service = makeService(prisma);

    const [applicant] = await service.getApplicants('org-1', 'job-1');
    expect(applicant.hasPortfolio).toBe(true);
  });
});
