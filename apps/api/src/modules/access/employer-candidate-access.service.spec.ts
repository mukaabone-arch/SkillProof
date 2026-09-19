import { EmployerCandidateAccessService } from './employer-candidate-access.service';

function fakePrisma(overrides: {
  applications?: { candidateProfileId: string; orgId: string }[];
  shortlistEntries?: { candidateId: string; orgId: string }[];
  assessmentRequests?: { candidateId: string; orgId: string }[];
}) {
  const applications = overrides.applications ?? [];
  const shortlistEntries = overrides.shortlistEntries ?? [];
  const assessmentRequests = overrides.assessmentRequests ?? [];

  return {
    application: {
      findFirst: jest.fn(async ({ where }: any) => {
        const match = applications.find(
          (a) => a.candidateProfileId === where.candidateProfileId && a.orgId === where.job.orgId,
        );
        return match ? { id: 'app-1' } : null;
      }),
    },
    shortlistEntry: {
      findFirst: jest.fn(async ({ where }: any) => {
        const match = shortlistEntries.find((s) => s.candidateId === where.candidateId && s.orgId === where.orgId);
        return match ? { id: 'sl-1' } : null;
      }),
    },
    assessmentRequest: {
      findFirst: jest.fn(async ({ where }: any) => {
        const match = assessmentRequests.find((r) => r.candidateId === where.candidateId && r.orgId === where.orgId);
        return match ? { id: 'ar-1' } : null;
      }),
    },
  };
}

describe('EmployerCandidateAccessService.employerCanViewCandidate', () => {
  it('is true only when the candidate has applied to one of this org\'s jobs', async () => {
    const prisma = fakePrisma({ applications: [{ candidateProfileId: 'cand-1', orgId: 'org-1' }] });
    const svc = new EmployerCandidateAccessService(prisma as never);

    await expect(svc.employerCanViewCandidate('org-1', 'cand-1')).resolves.toBe(true);
    await expect(svc.employerCanViewCandidate('org-2', 'cand-1')).resolves.toBe(false);
  });

  it('is false for a shortlist-only relationship (no application)', async () => {
    const prisma = fakePrisma({ shortlistEntries: [{ candidateId: 'cand-1', orgId: 'org-1' }] });
    const svc = new EmployerCandidateAccessService(prisma as never);

    await expect(svc.employerCanViewCandidate('org-1', 'cand-1')).resolves.toBe(false);
  });
});

describe('EmployerCandidateAccessService.employerCanViewPortfolio', () => {
  it('is true for an application-only relationship', async () => {
    const prisma = fakePrisma({ applications: [{ candidateProfileId: 'cand-1', orgId: 'org-1' }] });
    const svc = new EmployerCandidateAccessService(prisma as never);

    await expect(svc.employerCanViewPortfolio('org-1', 'cand-1')).resolves.toBe(true);
  });

  it('is true for a shortlist-only relationship (unlike employerCanViewCandidate)', async () => {
    const prisma = fakePrisma({ shortlistEntries: [{ candidateId: 'cand-1', orgId: 'org-1' }] });
    const svc = new EmployerCandidateAccessService(prisma as never);

    await expect(svc.employerCanViewPortfolio('org-1', 'cand-1')).resolves.toBe(true);
  });

  it('is true for an assessment-request-only relationship', async () => {
    const prisma = fakePrisma({ assessmentRequests: [{ candidateId: 'cand-1', orgId: 'org-1' }] });
    const svc = new EmployerCandidateAccessService(prisma as never);

    await expect(svc.employerCanViewPortfolio('org-1', 'cand-1')).resolves.toBe(true);
  });

  it('is false with no relationship of any kind', async () => {
    const prisma = fakePrisma({});
    const svc = new EmployerCandidateAccessService(prisma as never);

    await expect(svc.employerCanViewPortfolio('org-1', 'cand-1')).resolves.toBe(false);
  });

  it('never confuses a different org\'s relationship for this org\'s', async () => {
    const prisma = fakePrisma({ shortlistEntries: [{ candidateId: 'cand-1', orgId: 'org-2' }] });
    const svc = new EmployerCandidateAccessService(prisma as never);

    await expect(svc.employerCanViewPortfolio('org-1', 'cand-1')).resolves.toBe(false);
  });
});
