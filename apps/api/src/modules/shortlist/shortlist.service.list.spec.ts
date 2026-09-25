import { ShortlistService } from './shortlist.service';

function baseEntry(overrides: any = {}) {
  return {
    id: 'entry-1',
    candidateId: 'cand-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    stage: 'SOURCED',
    note: null,
    inviteMessage: null,
    rejectReason: null,
    candidateResponse: null,
    addedByUserId: 'user-1',
    job: null,
    rounds: [],
    candidateProfile: {
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
      portfolio: null,
    },
    ...overrides,
  };
}

function makeService(entries: any[]) {
  const prisma = { shortlistEntry: { findMany: jest.fn(async () => entries) } };
  return new ShortlistService(prisma as any, {} as any);
}

describe('ShortlistService.list — hasPortfolio', () => {
  it('a candidate with no CandidatePortfolio row → no link', async () => {
    const service = makeService([baseEntry()]);
    const [entry] = await service.list('org-1');
    expect(entry.hasPortfolio).toBe(false);
  });

  it('approvedAt null → no link, even though the row exists', async () => {
    const service = makeService([
      baseEntry({ candidateProfile: { ...baseEntry().candidateProfile, portfolio: { approvedAt: null, visibleToEmployers: true } } }),
    ]);
    const [entry] = await service.list('org-1');
    expect(entry.hasPortfolio).toBe(false);
  });

  it('visibleToEmployers false → no link, even though approvedAt is set', async () => {
    const service = makeService([
      baseEntry({
        candidateProfile: {
          ...baseEntry().candidateProfile,
          portfolio: { approvedAt: new Date(), visibleToEmployers: false },
        },
      }),
    ]);
    const [entry] = await service.list('org-1');
    expect(entry.hasPortfolio).toBe(false);
  });

  it('both set → link rendered', async () => {
    const service = makeService([
      baseEntry({
        candidateProfile: {
          ...baseEntry().candidateProfile,
          portfolio: { approvedAt: new Date(), visibleToEmployers: true },
        },
      }),
    ]);
    const [entry] = await service.list('org-1');
    expect(entry.hasPortfolio).toBe(true);
  });
});
