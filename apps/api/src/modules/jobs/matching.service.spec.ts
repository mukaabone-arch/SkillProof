import { SubscriptionTier } from '@prisma/client';
import { MatchingService } from './matching.service';
import { LlmService } from '../../llm/llm.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

const SKILL_A = { id: 'skill-a', name: 'Python' };
const SKILL_B = { id: 'skill-b', name: 'SQL' };
/** Never part of a job's requirements in these tests — used only to give a
 * profile a VERIFIED claim "somewhere" so it clears the privacy gate
 * (candidateProfile.findMany's `skillClaims.some(status: VERIFIED)`
 * condition) while keeping its claims on the job's own skills unverified. */
const SKILL_C = { id: 'skill-c', name: 'Unrelated' };

interface FakeClaim {
  id: string;
  profileId: string;
  skillId: string;
  level: string;
  status: 'VERIFIED' | 'UNVERIFIED' | 'EXPIRED';
  hasBadge?: boolean;
}

interface FakeProfile {
  id: string;
  fullName: string;
  headline?: string | null;
  yearsOfExp?: number | null;
  deletedAt?: Date | null;
  deactivatedAt?: Date | null;
  isInternalTestAccount?: boolean;
}

/**
 * Enough of PrismaService to drive MatchingService.getMatches end to end —
 * same fake-prisma-object convention as
 * employer-candidate-access.service.spec.ts, just covering the extra models
 * (job, candidateProfile, skillClaim) this service touches.
 */
function fakePrisma(opts: {
  job: { id: string; orgId: string; experienceMin?: number | null; experienceMax?: number | null; skills: { skillId: string; requiredLevel: string; isRequired: boolean; skill: { id: string; name: string } }[] } | null;
  profiles: FakeProfile[];
  claims: FakeClaim[];
}) {
  const { job, profiles, claims } = opts;

  function visible(p: FakeProfile): boolean {
    return !p.deletedAt && !p.deactivatedAt && !p.isInternalTestAccount;
  }

  return {
    job: {
      findUnique: jest.fn(async () => job),
    },
    candidateProfile: {
      findMany: jest.fn(async ({ where }: any) => {
        const jobSkillIds: string[] = where.AND[1].skillClaims.some.skillId.in;
        return profiles
          .filter(visible)
          .filter((p) => claims.some((c) => c.profileId === p.id && c.status === 'VERIFIED'))
          .filter((p) => claims.some((c) => c.profileId === p.id && jobSkillIds.includes(c.skillId)))
          .map((p) => ({
            ...p,
            headline: p.headline ?? null,
            yearsOfExp: p.yearsOfExp ?? null,
            skillClaims: claims
              .filter((c) => c.profileId === p.id && jobSkillIds.includes(c.skillId))
              .map((c) => ({
                id: c.id,
                skillId: c.skillId,
                level: c.level,
                status: c.status,
                skill: c.skillId === SKILL_A.id ? SKILL_A : SKILL_B,
                badge: c.hasBadge
                  ? { verifiedBy: 'TEST', verifyHash: `hash-${c.id}`, attemptNumber: 1 }
                  : null,
              })),
            certifications: [],
          }));
      }),
    },
    skillClaim: {
      findMany: jest.fn(async ({ where }: any) => {
        const skillIds: string[] = where.skillId.in;
        const holderSkillIds = new Set(
          claims
            .filter((c) => c.status === 'VERIFIED' && skillIds.includes(c.skillId))
            .filter((c) => {
              const p = profiles.find((pr) => pr.id === c.profileId);
              return p && visible(p);
            })
            .map((c) => c.skillId),
        );
        return [...holderSkillIds].map((skillId) => ({ skillId }));
      }),
    },
  };
}

function fakeLlm(): LlmService {
  return { explainMatch: jest.fn(async () => 'Explanation') } as unknown as LlmService;
}

function fakeEntitlements(profileIds: string[], tier: SubscriptionTier = SubscriptionTier.FREE): EntitlementsService {
  return {
    resolveEffectiveTiersForCandidates: jest.fn(async () => new Map(profileIds.map((id) => [id, tier]))),
  } as unknown as EntitlementsService;
}

const REQUIRED_JOB_SKILLS = [
  { skillId: SKILL_A.id, requiredLevel: 'L2', isRequired: true, skill: SKILL_A },
  { skillId: SKILL_B.id, requiredLevel: 'L2', isRequired: false, skill: SKILL_B },
];

describe('MatchingService.getMatches — funnel', () => {
  it('every funnel number equals the count of rows at that tier', async () => {
    // strong: verified L2+ on both required+optional skill -> full credit both, weighted 100
    // verified-only: verified L2 required skill only -> (1*2)/(2+1)*100 = 66.7 -> "good"/verifiedMatch tier
    // relevant-only: unverified L2 required skill only -> 0.4*2/3*100 = 26.7 -> "partial"/relevant tier
    // considered-only (below relevant): unverified L1 required (below level) -> 0.2*2/3*100 = 13.3
    const profiles: FakeProfile[] = [
      { id: 'strong', fullName: 'Strong Candidate' },
      { id: 'verified', fullName: 'Verified Candidate' },
      { id: 'relevant', fullName: 'Relevant Candidate' },
      { id: 'considered', fullName: 'Considered Candidate' },
    ];
    const claims: FakeClaim[] = [
      { id: 'c1', profileId: 'strong', skillId: SKILL_A.id, level: 'L2', status: 'VERIFIED', hasBadge: true },
      { id: 'c2', profileId: 'strong', skillId: SKILL_B.id, level: 'L2', status: 'VERIFIED', hasBadge: true },
      { id: 'c3', profileId: 'verified', skillId: SKILL_A.id, level: 'L2', status: 'VERIFIED', hasBadge: true },
      { id: 'c4', profileId: 'relevant', skillId: SKILL_A.id, level: 'L2', status: 'UNVERIFIED' },
      // Verified somewhere else, so 'relevant' still clears the privacy gate
      // despite every job-relevant claim being unverified.
      { id: 'c4v', profileId: 'relevant', skillId: SKILL_C.id, level: 'L1', status: 'VERIFIED' },
      { id: 'c5', profileId: 'considered', skillId: SKILL_A.id, level: 'L1', status: 'UNVERIFIED' },
      { id: 'c5v', profileId: 'considered', skillId: SKILL_C.id, level: 'L1', status: 'VERIFIED' },
    ];

    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1', experienceMin: null, experienceMax: null, skills: REQUIRED_JOB_SKILLS },
      profiles,
      claims,
    });
    const svc = new MatchingService(
      prisma as never,
      fakeLlm(),
      fakeEntitlements(profiles.map((p) => p.id)),
    );

    const result = await svc.getMatches('org-1', 'job-1');

    expect(result.funnel).toEqual({ considered: 4, relevant: 3, verifiedMatch: 2, strongMatch: 1 });
    // Tiers nested: strong ⊆ verified ⊆ relevant ⊆ considered.
    expect(result.funnel.strongMatch).toBeLessThanOrEqual(result.funnel.verifiedMatch);
    expect(result.funnel.verifiedMatch).toBeLessThanOrEqual(result.funnel.relevant);
    expect(result.funnel.relevant).toBeLessThanOrEqual(result.funnel.considered);
  });

  it('a candidate with only unverified claims never reaches the verifiedMatch tier (45-point ceiling)', async () => {
    const profiles: FakeProfile[] = [{ id: 'p1', fullName: 'All Unverified' }];
    const claims: FakeClaim[] = [
      { id: 'c1', profileId: 'p1', skillId: SKILL_A.id, level: 'L4', status: 'UNVERIFIED' },
      { id: 'c2', profileId: 'p1', skillId: SKILL_B.id, level: 'L4', status: 'UNVERIFIED' },
      { id: 'c3', profileId: 'p1', skillId: SKILL_C.id, level: 'L1', status: 'VERIFIED' },
    ];
    const prisma = fakePrisma({
      job: {
        id: 'job-1',
        orgId: 'org-1',
        experienceMin: 0,
        experienceMax: 5,
        skills: REQUIRED_JOB_SKILLS,
      },
      profiles: profiles.map((p) => ({ ...p, yearsOfExp: 2 })), // within range -> +5 bonus
      claims,
    });
    const svc = new MatchingService(prisma as never, fakeLlm(), fakeEntitlements(['p1']));

    const result = await svc.getMatches('org-1', 'job-1');

    expect(result.allCandidates[0].score).toBeLessThan(50);
    expect(result.funnel.verifiedMatch).toBe(0);
    expect(result.funnel.strongMatch).toBe(0);
  });

  it('deleted and deactivated candidates appear in no tier and no count', async () => {
    const profiles: FakeProfile[] = [
      { id: 'active', fullName: 'Active' },
      { id: 'deleted', fullName: 'Deleted', deletedAt: new Date() },
      { id: 'deactivated', fullName: 'Deactivated', deactivatedAt: new Date() },
    ];
    const claims: FakeClaim[] = profiles.map((p, i) => ({
      id: `c${i}`,
      profileId: p.id,
      skillId: SKILL_A.id,
      level: 'L2',
      status: 'VERIFIED' as const,
      hasBadge: true,
    }));
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1', experienceMin: null, experienceMax: null, skills: REQUIRED_JOB_SKILLS },
      profiles,
      claims,
    });
    const svc = new MatchingService(prisma as never, fakeLlm(), fakeEntitlements(profiles.map((p) => p.id)));

    const result = await svc.getMatches('org-1', 'job-1');

    expect(result.funnel.considered).toBe(1);
    expect(result.allCandidates.map((c) => c.profileId)).toEqual(['active']);
  });

  it('zero-candidate job renders the zero state and names the unmatched required skills', async () => {
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1', experienceMin: null, experienceMax: null, skills: REQUIRED_JOB_SKILLS },
      profiles: [],
      claims: [],
    });
    const svc = new MatchingService(prisma as never, fakeLlm(), fakeEntitlements([]));

    const result = await svc.getMatches('org-1', 'job-1');

    expect(result.funnel).toEqual({ considered: 0, relevant: 0, verifiedMatch: 0, strongMatch: 0 });
    expect(result.unmatchedRequiredSkills).toEqual([{ skillId: SKILL_A.id, skillName: SKILL_A.name }]);
    expect(result.allCandidates).toEqual([]);
  });

  it('unmatchedRequiredSkills is empty once someone considered exists, even if no one is verified in that skill elsewhere', async () => {
    const profiles: FakeProfile[] = [{ id: 'p1', fullName: 'Someone' }];
    const claims: FakeClaim[] = [
      { id: 'c1', profileId: 'p1', skillId: SKILL_A.id, level: 'L1', status: 'UNVERIFIED' },
      { id: 'c2', profileId: 'p1', skillId: SKILL_C.id, level: 'L1', status: 'VERIFIED' },
    ];
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1', experienceMin: null, experienceMax: null, skills: REQUIRED_JOB_SKILLS },
      profiles,
      claims,
    });
    const svc = new MatchingService(prisma as never, fakeLlm(), fakeEntitlements(['p1']));

    const result = await svc.getMatches('org-1', 'job-1');

    expect(result.funnel.considered).toBe(1);
    expect(result.unmatchedRequiredSkills).toEqual([]);
  });

  it('contact details (email/phone) are absent from the payload', async () => {
    const profiles: FakeProfile[] = [{ id: 'p1', fullName: 'Someone' }];
    const claims: FakeClaim[] = [
      { id: 'c1', profileId: 'p1', skillId: SKILL_A.id, level: 'L2', status: 'VERIFIED', hasBadge: true },
    ];
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1', experienceMin: null, experienceMax: null, skills: REQUIRED_JOB_SKILLS },
      profiles,
      claims,
    });
    const svc = new MatchingService(prisma as never, fakeLlm(), fakeEntitlements(['p1']));

    const result = await svc.getMatches('org-1', 'job-1');

    const payload = JSON.stringify(result);
    expect(payload).not.toMatch(/email/i);
    expect(payload).not.toMatch(/phone/i);
  });

  it('job with no skills returns the empty funnel and no queries against candidates', async () => {
    const prisma = fakePrisma({
      job: { id: 'job-1', orgId: 'org-1', skills: [] },
      profiles: [{ id: 'p1', fullName: 'Someone' }],
      claims: [],
    });
    const svc = new MatchingService(prisma as never, fakeLlm(), fakeEntitlements(['p1']));

    const result = await svc.getMatches('org-1', 'job-1');

    expect(result.funnel).toEqual({ considered: 0, relevant: 0, verifiedMatch: 0, strongMatch: 0 });
    expect(result.candidates).toEqual([]);
    expect(result.allCandidates).toEqual([]);
    expect(prisma.candidateProfile.findMany).not.toHaveBeenCalled();
  });
});
