import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';

const NOW = new Date('2026-09-19T00:00:00Z');

/** Minimal in-memory tables — same convention as this codebase's other fake-Prisma specs (e.g. candidate-jobs.service.apply.spec.ts). Methods a correctness test needs to prove are never called (skillClaim.create, certification.create) throw instead of silently no-op-ing. */
function fakePrisma() {
  const profiles: any[] = [];
  const portfolios: any[] = [];

  return {
    _profiles: profiles,
    _portfolios: portfolios,
    candidateProfile: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const profile = profiles.find((p) => (where.userId ? p.userId === where.userId : p.id === where.id));
        if (!profile) return null;
        if (!include) return profile;
        const portfolio = portfolios.find((pf) => pf.profileId === profile.id) ?? null;
        return {
          ...profile,
          skillClaims: include.skillClaims ? profile.skillClaims ?? [] : undefined,
          certifications: include.certifications ? profile.certifications ?? [] : undefined,
          portfolio: include.portfolio ? portfolio : undefined,
        };
      }),
      findFirst: jest.fn(async ({ where, include }: any) => {
        const profile = profiles.find((p) => p.id === where.id);
        if (!profile) return null;
        const portfolio =
          profile.portfolio !== undefined ? profile.portfolio : portfolios.find((pf) => pf.profileId === profile.id) ?? null;
        return {
          ...profile,
          skillClaims: profile.skillClaims ?? [],
          certifications: profile.certifications ?? [],
          portfolio,
          user: include?.user ? profile.user ?? { email: null, phone: null } : undefined,
        };
      }),
    },
    candidatePortfolio: {
      findUnique: jest.fn(async ({ where }: any) => portfolios.find((pf) => pf.profileId === where.profileId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = portfolios.find((pf) => pf.profileId === where.profileId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `portfolio-${portfolios.length + 1}`, approvedAt: null, visibleToEmployers: false, parsedAt: NOW, ...create };
        portfolios.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = portfolios.find((pf) => pf.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    skillClaim: {
      create: jest.fn(() => {
        throw new Error('SkillClaim.create must never be called by PortfolioService');
      }),
      update: jest.fn(() => {
        throw new Error('SkillClaim.update must never be called by PortfolioService');
      }),
    },
    certification: {
      create: jest.fn(() => {
        throw new Error('Certification.create must never be called by PortfolioService');
      }),
    },
  };
}

function makeLlm(extraction: any = sampleExtraction()) {
  return {
    extractPortfolio: jest.fn(async () => extraction),
  };
}

function makeAccess(overrides: { canViewPortfolio?: boolean; canViewCandidate?: boolean } = {}) {
  return {
    employerCanViewPortfolio: jest.fn(async () => overrides.canViewPortfolio ?? true),
    employerCanViewCandidate: jest.fn(async () => overrides.canViewCandidate ?? false),
  };
}

function sampleExtraction() {
  return {
    headline: 'AI/ML Engineer',
    summary: 'Builds things.',
    experience: [],
    projects: [],
    education: [],
    skillGroups: [{ category: 'Programming', skills: ['Python'] }],
  };
}

describe('PortfolioService', () => {
  it('parseFromResume creates a portfolio with no SkillClaim/Certification writes (scoring boundary)', async () => {
    const prisma = fakePrisma();
    prisma._profiles.push({ id: 'profile-1', userId: 'user-1' });
    const llm = makeLlm();
    const svc = new PortfolioService(prisma as never, llm as never, makeAccess() as never);

    await svc.parseFromResume('user-1', Buffer.from('pdf-bytes'), 'resume-key-1.pdf');

    expect(llm.extractPortfolio).toHaveBeenCalledTimes(1);
    expect(prisma._portfolios).toHaveLength(1);
    expect(prisma._portfolios[0].content.skillGroups).toEqual([{ category: 'Programming', skills: ['Python'] }]);
    expect(prisma.skillClaim.create).not.toHaveBeenCalled();
    expect(prisma.certification.create).not.toHaveBeenCalled();
  });

  it('re-parsing (re-upload) resets approvedAt to null but keeps visibleToEmployers as-is', async () => {
    const prisma = fakePrisma();
    prisma._profiles.push({ id: 'profile-1', userId: 'user-1' });
    prisma._portfolios.push({
      id: 'portfolio-1',
      profileId: 'profile-1',
      content: sampleExtraction(),
      approvedAt: NOW,
      visibleToEmployers: true,
      sourceResumeKey: 'old-key.pdf',
      parsedAt: NOW,
    });
    const llm = makeLlm();
    const svc = new PortfolioService(prisma as never, llm as never, makeAccess() as never);

    await svc.parseFromResume('user-1', Buffer.from('pdf-bytes'), 'new-key.pdf');

    const portfolio = prisma._portfolios[0];
    expect(portfolio.approvedAt).toBeNull();
    expect(portfolio.visibleToEmployers).toBe(true);
    expect(portfolio.sourceResumeKey).toBe('new-key.pdf');
  });

  it('a parse failure is swallowed — no portfolio row is created or corrupted', async () => {
    const prisma = fakePrisma();
    prisma._profiles.push({ id: 'profile-1', userId: 'user-1' });
    const llm = { extractPortfolio: jest.fn(async () => { throw new Error('LLM down'); }) };
    const svc = new PortfolioService(prisma as never, llm as never, makeAccess() as never);

    await expect(svc.parseFromResume('user-1', Buffer.from('x'), 'k.pdf')).resolves.toBeUndefined();
    expect(prisma._portfolios).toHaveLength(0);
  });

  describe('editing an approved draft', () => {
    it('updateContent un-approves the portfolio', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push({ id: 'profile-1', userId: 'user-1' });
      prisma._portfolios.push({
        id: 'portfolio-1',
        profileId: 'profile-1',
        content: sampleExtraction(),
        approvedAt: NOW,
        visibleToEmployers: true,
        parsedAt: NOW,
      });
      const svc = new PortfolioService(prisma as never, makeLlm() as never, makeAccess() as never);

      const edited = { ...sampleExtraction(), headline: 'Edited headline' };
      await svc.updateContent('user-1', edited as never);

      expect(prisma._portfolios[0].approvedAt).toBeNull();
      expect(prisma._portfolios[0].content.headline).toBe('Edited headline');
    });

    it('approve sets approvedAt', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push({ id: 'profile-1', userId: 'user-1' });
      prisma._portfolios.push({ id: 'portfolio-1', profileId: 'profile-1', content: sampleExtraction(), approvedAt: null, visibleToEmployers: false, parsedAt: NOW });
      const svc = new PortfolioService(prisma as never, makeLlm() as never, makeAccess() as never);

      const result = await svc.approve('user-1');

      expect(prisma._portfolios[0].approvedAt).not.toBeNull();
      expect(result.approvedAt).not.toBeNull();
    });

    it('updateContent/approve 404 when no portfolio exists yet', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push({ id: 'profile-1', userId: 'user-1' });
      const svc = new PortfolioService(prisma as never, makeLlm() as never, makeAccess() as never);

      await expect(svc.approve('user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMine — verification split and honest empty state', () => {
    it('returns verified badges and self-reported skillGroups as distinguishable groups', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push({
        id: 'profile-1',
        userId: 'user-1',
        resumeS3Key: 'r.pdf',
        skillClaims: [
          {
            skillId: 'skill-1',
            skill: { name: 'RAG Systems' },
            level: 'L3',
            badge: { verifiedBy: 'TEST', verifyHash: 'hash-1', issuedAt: NOW, expiresAt: NOW },
          },
        ],
        certifications: [],
      });
      prisma._portfolios.push({
        id: 'portfolio-1',
        profileId: 'profile-1',
        content: sampleExtraction(),
        approvedAt: null,
        visibleToEmployers: false,
        parsedAt: NOW,
      });
      const svc = new PortfolioService(prisma as never, makeLlm() as never, makeAccess() as never);

      const result = await svc.getMine('user-1');

      expect(result.verifiedBadges).toEqual([
        expect.objectContaining({ skillId: 'skill-1', skillName: 'RAG Systems', level: 'L3' }),
      ]);
      expect((result.content as any).skillGroups).toEqual([{ category: 'Programming', skills: ['Python'] }]);
      // The two must never be merged into one list.
      expect(result.verifiedBadges).not.toEqual(expect.arrayContaining([expect.objectContaining({ category: expect.anything() })]));
    });

    it('a candidate with zero verified badges gets an empty array, not a padded count', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push({ id: 'profile-1', userId: 'user-1', resumeS3Key: 'r.pdf', skillClaims: [], certifications: [] });
      prisma._portfolios.push({ id: 'portfolio-1', profileId: 'profile-1', content: sampleExtraction(), approvedAt: null, visibleToEmployers: false, parsedAt: NOW });
      const svc = new PortfolioService(prisma as never, makeLlm() as never, makeAccess() as never);

      const result = await svc.getMine('user-1');

      expect(result.verifiedBadges).toEqual([]);
    });

    it('never calls the LLM on a read — parsing only ever happens from parseFromResume', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push({ id: 'profile-1', userId: 'user-1', resumeS3Key: 'r.pdf', skillClaims: [], certifications: [] });
      prisma._portfolios.push({ id: 'portfolio-1', profileId: 'profile-1', content: sampleExtraction(), approvedAt: null, visibleToEmployers: false, parsedAt: NOW });
      const llm = makeLlm();
      const svc = new PortfolioService(prisma as never, llm as never, makeAccess() as never);

      await svc.getMine('user-1');
      await svc.getMine('user-1');

      expect(llm.extractPortfolio).not.toHaveBeenCalled();
    });
  });

  describe('getForEmployer — access gates', () => {
    function profileWithApprovedPortfolio(overrides: { approvedAt?: Date | null; visibleToEmployers?: boolean } = {}) {
      return {
        id: 'profile-1',
        skillClaims: [],
        certifications: [],
        portfolio: {
          content: sampleExtraction(),
          approvedAt: overrides.approvedAt !== undefined ? overrides.approvedAt : NOW,
          visibleToEmployers: overrides.visibleToEmployers ?? true,
        },
        user: { email: 'candidate@example.com', phone: '+911234567890' },
      };
    }

    it('403s an employer with no relationship to the candidate at all', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push(profileWithApprovedPortfolio());
      const access = makeAccess({ canViewPortfolio: false });
      const svc = new PortfolioService(prisma as never, makeLlm() as never, access as never);

      await expect(svc.getForEmployer('org-1', 'profile-1')).rejects.toThrow(ForbiddenException);
    });

    it('404s when approvedAt is null, even with a valid relationship', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push(profileWithApprovedPortfolio({ approvedAt: null }));
      const svc = new PortfolioService(prisma as never, makeLlm() as never, makeAccess() as never);

      await expect(svc.getForEmployer('org-1', 'profile-1')).rejects.toThrow(NotFoundException);
    });

    it('404s when visibleToEmployers is false, even when approved', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push(profileWithApprovedPortfolio({ visibleToEmployers: false }));
      const svc = new PortfolioService(prisma as never, makeLlm() as never, makeAccess() as never);

      await expect(svc.getForEmployer('org-1', 'profile-1')).rejects.toThrow(NotFoundException);
    });

    it('omits contact details until employerCanViewCandidate (Application-based) is satisfied', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push(profileWithApprovedPortfolio());
      const access = makeAccess({ canViewPortfolio: true, canViewCandidate: false });
      const svc = new PortfolioService(prisma as never, makeLlm() as never, access as never);

      const result = await svc.getForEmployer('org-1', 'profile-1');

      expect(result.contact).toBeNull();
    });

    it('includes contact details once employerCanViewCandidate is satisfied', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push(profileWithApprovedPortfolio());
      const access = makeAccess({ canViewPortfolio: true, canViewCandidate: true });
      const svc = new PortfolioService(prisma as never, makeLlm() as never, access as never);

      const result = await svc.getForEmployer('org-1', 'profile-1');

      expect(result.contact).toEqual({ email: 'candidate@example.com', phone: '+911234567890' });
    });

    it('returns approved, visible content for a valid relationship', async () => {
      const prisma = fakePrisma();
      prisma._profiles.push(profileWithApprovedPortfolio());
      const svc = new PortfolioService(prisma as never, makeLlm() as never, makeAccess() as never);

      const result = await svc.getForEmployer('org-1', 'profile-1');

      expect(result.content).toEqual(sampleExtraction());
    });
  });
});
