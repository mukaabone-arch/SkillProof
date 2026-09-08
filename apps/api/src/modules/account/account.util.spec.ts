import { assertCandidateAvailableForPipeline, candidateVisibilityFilter } from './account.util';

function fakePrisma(profile: { id: string; deletedAt: Date | null; deactivatedAt: Date | null } | null) {
  return {
    candidateProfile: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; deletedAt?: null; deactivatedAt?: null } }) => {
        if (!profile || profile.id !== where.id) return null;
        if (where.deletedAt === null && profile.deletedAt !== null) return null;
        if (where.deactivatedAt === null && profile.deactivatedAt !== null) return null;
        return profile;
      }),
    },
  };
}

describe('candidateVisibilityFilter', () => {
  it('requires deletedAt/deactivatedAt to be null and excludes internal test accounts', () => {
    expect(candidateVisibilityFilter).toEqual({ deletedAt: null, deactivatedAt: null, isInternalTestAccount: false });
  });
});

describe('assertCandidateAvailableForPipeline', () => {
  it('resolves for a visible candidate', async () => {
    const prisma = fakePrisma({ id: 'p1', deletedAt: null, deactivatedAt: null });
    await expect(assertCandidateAvailableForPipeline(prisma as never, 'p1')).resolves.toBeUndefined();
  });

  it('rejects a deactivated candidate', async () => {
    const prisma = fakePrisma({ id: 'p1', deletedAt: null, deactivatedAt: new Date() });
    await expect(assertCandidateAvailableForPipeline(prisma as never, 'p1')).rejects.toThrow('not available');
  });

  it('rejects a deleted candidate', async () => {
    const prisma = fakePrisma({ id: 'p1', deletedAt: new Date(), deactivatedAt: null });
    await expect(assertCandidateAvailableForPipeline(prisma as never, 'p1')).rejects.toThrow('not available');
  });

  it('rejects a nonexistent candidate', async () => {
    const prisma = fakePrisma(null);
    await expect(assertCandidateAvailableForPipeline(prisma as never, 'missing')).rejects.toThrow('not available');
  });
});
