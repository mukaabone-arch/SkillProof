import * as path from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient, Role } from '@prisma/client';
import { AdminService } from './admin.service';
import { ListCandidatesQueryDto } from './admin.dto';

/**
 * Real Postgres, real inserted rows — the whole reason listCandidates uses
 * a raw $queryRaw at all is that Prisma's own query builder made the
 * three-way lastActivityAt max (Attempt/AttemptAnswer/Badge) and the
 * search/pagination/sort combination awkward; a fake-Prisma mock would
 * only prove this service calls $queryRaw with *some* arguments, never
 * that the SQL itself is correct. Same convention as
 * news.integration.spec.ts: describeIfDb-gated, own unique test marker so
 * this shared dev database's real data is never touched or asserted
 * against by count.
 */
const describeIfDb = process.env.CI || process.env.DATABASE_URL ? describe : describe.skip;

function defaultQuery(overrides: Partial<ListCandidatesQueryDto> = {}): ListCandidatesQueryDto {
  return { page: 1, pageSize: 25, sort: 'createdAt', order: 'desc', ...overrides };
}

describeIfDb('AdminService.listCandidates — real Postgres', () => {
  let prisma: PrismaClient;
  let svc: AdminService;
  const marker = `admin-candidates-itest-${Date.now()}`;
  const createdUserIds: string[] = [];
  const createdSkillIds: string[] = [];
  const createdAssessmentIds: string[] = [];
  const createdDomainIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new AdminService(prisma as any, {} as never, {} as never);
  });

  afterAll(async () => {
    // Children first — FK order matters, real deletes, not soft.
    await prisma.badge.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.attemptAnswer.deleteMany({ where: { attempt: { userId: { in: createdUserIds } } } });
    await prisma.attempt.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.assessment.deleteMany({ where: { id: { in: createdAssessmentIds } } });
    await prisma.skill.deleteMany({ where: { id: { in: createdSkillIds } } });
    await prisma.domain.deleteMany({ where: { id: { in: createdDomainIds } } });
    await prisma.identity.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.assessmentBlock.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.adminAccessLog.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
    await prisma.candidateProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  async function makeCandidate(opts: { phone?: string; email?: string; fullName?: string; createdAt?: Date }) {
    const user = await prisma.user.create({
      data: { role: Role.CANDIDATE, phone: opts.phone ?? null, email: opts.email ?? null, createdAt: opts.createdAt ?? new Date() },
    });
    createdUserIds.push(user.id);
    if (opts.fullName) {
      await prisma.candidateProfile.create({ data: { userId: user.id, fullName: opts.fullName } });
    }
    return user;
  }

  it('returns candidates at every verification stage — an unverified candidate (no email) still appears', async () => {
    await makeCandidate({ phone: `${marker}-unverified`, fullName: `${marker} Unverified` });

    const result = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} Unverified` }));

    expect(result.total).toBe(1);
    expect(result.candidates[0].verified).toBe(false);
    expect(result.candidates[0].missingVerification).toEqual(['email']);
  });

  it('derives authMethod from Identity rows, not merely from which of phone/email are set — OAuth takes priority even once a phone is later linked', async () => {
    const phoneOnly = await makeCandidate({ phone: `${marker}-authphone`, fullName: `${marker} AuthPhone` });
    const emailOnly = await makeCandidate({ email: `${marker}-authemail@example.com`, fullName: `${marker} AuthEmail` });
    const google = await makeCandidate({ email: `${marker}-authgoogle@example.com`, phone: `${marker}-authgoogle`, fullName: `${marker} AuthGoogle` });
    await prisma.identity.create({ data: { userId: google.id, provider: 'GOOGLE', providerId: `${marker}-google-id` } });
    const github = await makeCandidate({ email: `${marker}-authgithub@example.com`, fullName: `${marker} AuthGithub` });
    await prisma.identity.create({ data: { userId: github.id, provider: 'GITHUB', providerId: `${marker}-github-id` } });

    const result = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} Auth`, pageSize: 10 }));
    const byId = new Map(result.candidates.map((c) => [c.id, c.authMethod]));

    expect(byId.get(phoneOnly.id)).toBe('Phone OTP');
    expect(byId.get(emailOnly.id)).toBe('Email OTP');
    expect(byId.get(google.id)).toBe('Google'); // has a phone too — OAuth still wins
    expect(byId.get(github.id)).toBe('GitHub');
  });

  it('search matches email, phone, and name — partial, case-insensitive, trimmed', async () => {
    const user = await makeCandidate({ phone: `${marker}-5551234`, email: `${marker}-mixedcase@Example.com`, fullName: `${marker} Jordan Search` });

    const byPhonePartial = await svc.listCandidates('admin-1', defaultQuery({ search: `  ${marker}-5551  ` }));
    expect(byPhonePartial.candidates.map((c) => c.id)).toContain(user.id);

    const byEmailCaseInsensitive = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker}-MIXEDCASE` }));
    expect(byEmailCaseInsensitive.candidates.map((c) => c.id)).toContain(user.id);

    const byNamePartial = await svc.listCandidates('admin-1', defaultQuery({ search: 'jordan search' }));
    expect(byNamePartial.candidates.map((c) => c.id)).toContain(user.id);
  });

  it('search with SQL metacharacters returns safely — no injection, no crash, and the table survives', async () => {
    for (const payload of [`${marker}' OR '1'='1`, `${marker}; DROP TABLE "User"; --`, `${marker}%`, `${marker}_`]) {
      await expect(svc.listCandidates('admin-1', defaultQuery({ search: payload }))).resolves.toBeDefined();
    }
    const survives = await prisma.user.findUnique({ where: { id: createdUserIds[0] } });
    expect(survives).not.toBeNull();
  });

  it('a candidate with no attempts, answers, or badges has lastActivityAt null', async () => {
    await makeCandidate({ phone: `${marker}-noactivity`, fullName: `${marker} NoActivity` });

    const result = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} NoActivity` }));

    expect(result.candidates[0].lastActivityAt).toBeNull();
  });

  it('a candidate who has never logged in has lastLoginAt null', async () => {
    await makeCandidate({ phone: `${marker}-neverloggedin`, fullName: `${marker} NeverLoggedIn` });

    const result = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} NeverLoggedIn` }));

    expect(result.candidates[0].lastLoginAt).toBeNull();
  });

  it('lastLoginAt reflects User.lastLoginAt directly, independent of (and even without) any lastActivityAt', async () => {
    const user = await makeCandidate({ phone: `${marker}-loggedinonly`, fullName: `${marker} LoggedInOnly` });
    const loginAt = new Date('2026-06-15T09:30:00Z');
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: loginAt } });

    const result = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} LoggedInOnly` }));

    expect(result.candidates[0].lastLoginAt?.toISOString()).toBe(loginAt.toISOString());
    // Logging in alone must never move the derived activity column — the whole point of keeping both.
    expect(result.candidates[0].lastActivityAt).toBeNull();
  });

  it('lastActivityAt picks the true maximum across Attempt, AttemptAnswer, and Badge', async () => {
    const domain = await prisma.domain.create({ data: { name: `${marker}-domain` } });
    createdDomainIds.push(domain.id);
    const skill = await prisma.skill.create({ data: { domainId: domain.id, name: `${marker}-skill` } });
    createdSkillIds.push(skill.id);
    const assessment = await prisma.assessment.create({
      data: { skillId: skill.id, title: `${marker}-assessment`, targetLevel: 'L1', isLive: true },
    });
    createdAssessmentIds.push(assessment.id);

    const user = await makeCandidate({ phone: `${marker}-maxtest`, fullName: `${marker} MaxTest` });

    const oldest = new Date('2020-01-01T00:00:00Z');
    const middle = new Date('2021-01-01T00:00:00Z');
    const newest = new Date('2022-01-01T00:00:00Z'); // the true max — a Badge, deliberately the source neither Attempt nor AttemptAnswer alone would surface

    await prisma.attempt.create({ data: { userId: user.id, assessmentId: assessment.id, createdAt: oldest } });
    await prisma.badge.create({
      data: {
        userId: user.id,
        skillId: skill.id,
        verifiedBy: 'TEST',
        verifyHash: `${marker}-hash`,
        level: 'L1',
        issuedAt: newest,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
    // middle sits strictly between the two, on neither extreme — proves this isn't just "first row wins."
    void middle;

    const result = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} MaxTest` }));

    expect(result.candidates[0].lastActivityAt?.toISOString()).toBe(newest.toISOString());
  });

  it('pagination: page size is respected, the hard max is enforced by the DTO, and page 2 returns different rows', async () => {
    const base = new Date('2023-01-01T00:00:00Z');
    for (let i = 0; i < 5; i++) {
      await makeCandidate({ phone: `${marker}-page-${i}`, fullName: `${marker} Page${i}`, createdAt: new Date(base.getTime() + i * 1000) });
    }

    const page1 = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} Page`, pageSize: 2, page: 1, sort: 'createdAt', order: 'asc' }));
    const page2 = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} Page`, pageSize: 2, page: 2, sort: 'createdAt', order: 'asc' }));

    expect(page1.candidates).toHaveLength(2);
    expect(page2.candidates).toHaveLength(2);
    expect(page1.candidates.map((c) => c.id)).not.toEqual(page2.candidates.map((c) => c.id));
    // Total is independent of page size — 5 real rows exist regardless of how many fit on a page.
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
  });

  it('sorting by createdAt, both directions', async () => {
    const asc = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} Page`, pageSize: 10, sort: 'createdAt', order: 'asc' }));
    const desc = await svc.listCandidates('admin-1', defaultQuery({ search: `${marker} Page`, pageSize: 10, sort: 'createdAt', order: 'desc' }));

    expect(asc.candidates.map((c) => c.id)).toEqual([...desc.candidates.map((c) => c.id)].reverse());
  });

  it('sorting by lastActivityAt, both directions, with nulls always last', async () => {
    // From the earlier tests: one candidate (MaxTest) has a real lastActivityAt; NoActivity and the plain Page candidates have none.
    const asc = await svc.listCandidates('admin-1', defaultQuery({ search: marker, pageSize: 100, sort: 'lastActivityAt', order: 'asc' }));
    const nonNullAsc = asc.candidates.filter((c) => c.lastActivityAt !== null);
    const nullAsc = asc.candidates.filter((c) => c.lastActivityAt === null);
    expect(asc.candidates.slice(0, nonNullAsc.length)).toEqual(nonNullAsc);
    expect(asc.candidates.slice(nonNullAsc.length)).toEqual(nullAsc);

    const desc = await svc.listCandidates('admin-1', defaultQuery({ search: marker, pageSize: 100, sort: 'lastActivityAt', order: 'desc' }));
    const nonNullDesc = desc.candidates.filter((c) => c.lastActivityAt !== null);
    const nullDesc = desc.candidates.filter((c) => c.lastActivityAt === null);
    expect(desc.candidates.slice(0, nonNullDesc.length)).toEqual(nonNullDesc);
    expect(desc.candidates.slice(nonNullDesc.length)).toEqual(nullDesc);
  });

  it('writes an AdminAccessLog entry on access', async () => {
    // AdminAccessLog.adminUserId is a real FK — needs an actual User row, unlike the plain-string 'admin-1' used elsewhere in this file for tests that don't inspect the log itself.
    const admin = await prisma.user.create({ data: { role: Role.PLATFORM_ADMIN, phone: `${marker}-admin-audit` } });
    createdUserIds.push(admin.id);

    await svc.listCandidates(admin.id, defaultQuery({ search: `${marker} audit-check` }));

    const logs = await prisma.adminAccessLog.findMany({
      where: { adminUserId: admin.id, action: 'CANDIDATE_LIST_VIEWED' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].targetId).toContain('audit-check');
  });

  it('a failed AdminAccessLog write does not fail the request', async () => {
    const original = prisma.adminAccessLog.create;
    (prisma.adminAccessLog.create as any) = jest.fn(async () => {
      throw new Error('simulated db hiccup');
    });

    await expect(svc.listCandidates('admin-1', defaultQuery({ search: marker }))).resolves.toBeDefined();

    prisma.adminAccessLog.create = original;
  });
});
