import { ClaimStatus, JobStatus, OrgType, OutreachCampaignStatus, OutreachStatus, RecruiterContactPreference } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OutreachService } from './outreach.service';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  orgId: 'o1',
  title: 'ML Engineer',
  description: 'Build retrieval systems.',
  employmentType: 'FULL_TIME',
  status: JobStatus.LIVE,
  remote: true,
  locationCity: 'Pune',
  locationRegion: null,
  locationCountry: 'IN',
  locationLegacy: null,
  experienceMin: null,
  experienceMax: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: 'INR',
  salaryNotDisclosed: true,
  skills: [{ skillId: 's1', requiredLevel: 'L2', isRequired: true, skill: { name: 'Python' } }],
  organization: { id: 'o1', name: 'Acme', type: OrgType.EMPLOYER },
  ...over,
});

const profile = (id: string, level: string, status: ClaimStatus, pref: RecruiterContactPreference = RecruiterContactPreference.ANYONE) => ({
  id,
  fullName: `${id.toUpperCase()} Person`,
  yearsOfExp: 4,
  recruiterContact: pref,
  skillClaims: [{ skillId: 's1', level, status }],
  certifications: [],
});

function setup(opts: { job?: ReturnType<typeof job>; profiles?: unknown[]; llmFails?: boolean } = {}) {
  const prisma = {
    job: { findUnique: jest.fn(async () => opts.job ?? job()) },
    outreachCampaign: {
      findFirst: jest.fn(async () => null as unknown),
      create: jest.fn(async () => ({ id: 'camp1' })),
      update: jest.fn(async () => ({})),
    },
    outreachMessage: {
      findMany: jest.fn(async () => [] as unknown[]),
      create: jest.fn(async ({ data }: { data: { candidateId: string } }) => ({ id: `m-${data.candidateId}` })),
      count: jest.fn(async () => 0),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      groupBy: jest.fn(async () => []),
    },
    outreachEvent: { create: jest.fn(async () => ({})), createMany: jest.fn(async () => ({})) },
    application: { findMany: jest.fn(async () => [{ candidateProfileId: 'applied1' }]) },
    shortlistEntry: { findMany: jest.fn(async () => []) },
    candidateProfile: { findMany: jest.fn(async () => opts.profiles ?? []) },
  };
  const llm = {
    draftOutreachMessages: jest.fn(async (input: { candidates: { key: string }[] }) => {
      if (opts.llmFails) throw new Error('down');
      return new Map(input.candidates.map((c) => [c.key, `Hi {name}, AI note for ${c.key}`]));
    }),
  };
  const entitlements = { resolveEffectiveTiersForCandidates: jest.fn(async (ids: string[]) => new Map(ids.map((i) => [i, 'FREE']))) };
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const svc = new OutreachService(
    prisma as unknown as PrismaService,
    llm as unknown as LlmService,
    entitlements as unknown as EntitlementsService,
    notifications as unknown as NotificationsService,
  );
  return { svc, prisma, llm, notifications };
}

describe('OutreachService', () => {
  it('refuses a job that is not live or has no skills', async () => {
    await expect(setup({ job: job({ status: JobStatus.DRAFT }) }).svc.createCampaign('o1', 'u1', 'j1')).rejects.toThrow(/Publish this job/);
    await expect(setup({ job: job({ skills: [] }) }).svc.createCampaign('o1', 'u1', 'j1')).rejects.toThrow(/Add the skills/);
  });

  it('ranks only reachable candidates: contact on, not already applied, and verified-only setting honoured', async () => {
    const { svc, prisma } = setup({
      profiles: [
        profile('weak', 'L1', ClaimStatus.UNVERIFIED),
        profile('strong', 'L3', ClaimStatus.VERIFIED),
        profile('picky', 'L3', ClaimStatus.VERIFIED, RecruiterContactPreference.VERIFIED_MATCHES),
      ],
    });
    const ranked = await svc.rankCandidates(job() as never);
    expect(ranked.map((r) => r.profileId).sort()).toEqual(['picky', 'strong']);
    expect(ranked[0].matchReason).toBe('Verified L3 Python');

    const where = (prisma.candidateProfile.findMany.mock.calls[0] as unknown as [{ where: { AND: unknown[] } }])[0].where.AND;
    expect(where).toContainEqual({ recruiterContact: { not: RecruiterContactPreference.OFF } });
    expect(where).toContainEqual({ id: { notIn: ['applied1'] } });
    expect(JSON.stringify(where)).not.toContain('openToStaffing');
  });

  it('recruiter orgs only reach candidates open to recruiters and not blocking them', async () => {
    const { svc, prisma } = setup({ profiles: [] });
    await svc.rankCandidates(job({ organization: { id: 'o1', name: 'Hire Co', type: OrgType.STAFFING } }) as never);
    const where = (prisma.candidateProfile.findMany.mock.calls[0] as unknown as [{ where: { AND: unknown[] } }])[0].where.AND;
    expect(where).toContainEqual({ openToStaffing: true });
    expect(where).toContainEqual({ staffingBlocks: { none: { orgId: 'o1' } } });
  });

  it('drafts with the AI and falls back to the template if it fails, never sending a name to the AI', async () => {
    const ok = setup({ profiles: [profile('strong', 'L3', ClaimStatus.VERIFIED)] });
    ok.prisma.outreachCampaign.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'camp1', orgId: 'o1', organization: { type: OrgType.EMPLOYER }, messages: [], job: {}, followUpDays: [3, 7] });
    await ok.svc.createCampaign('o1', 'u1', 'j1').catch(() => undefined);
    expect(JSON.stringify(ok.llm.draftOutreachMessages.mock.calls[0])).not.toContain('STRONG Person');
    expect((ok.prisma.outreachMessage.create.mock.calls[0] as unknown as [{ data: { body: string } }])[0].data.body).toBe('Hi STRONG, AI note for c1');

    const down = setup({ profiles: [profile('strong', 'L3', ClaimStatus.VERIFIED)], llmFails: true });
    await down.svc.createCampaign('o1', 'u1', 'j1').catch(() => undefined);
    const body = (down.prisma.outreachMessage.create.mock.calls[0] as unknown as [{ data: { body: string } }])[0].data.body;
    expect(body).toContain('Hi STRONG,');
    expect(body).toContain('Python (verified L3)');
  });

  it('send: skips candidates who turned contact off, holds weekly-limit ones, sends the rest once', async () => {
    const { svc, prisma, notifications } = setup();
    prisma.outreachCampaign.findFirst.mockResolvedValue({ id: 'camp1', orgId: 'o1', jobId: 'j1', status: OutreachCampaignStatus.ACTIVE, followUpDays: [3, 7] });
    const cp = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      userId: `user-${id}`,
      fullName: null,
      recruiterContact: RecruiterContactPreference.ANYONE,
      outreachWeeklyLimit: 3,
      openToStaffing: false,
      deletedAt: null,
      deactivatedAt: null,
      isInternalTestAccount: false,
      ...over,
    });
    prisma.outreachMessage.findMany.mockResolvedValue([
      { id: 'm1', score: 90, body: 'Hi A', candidateProfile: cp('a') },
      { id: 'm2', score: 80, body: 'Hi B', candidateProfile: cp('b', { recruiterContact: RecruiterContactPreference.OFF }) },
      { id: 'm3', score: 70, body: 'Hi C', candidateProfile: cp('c', { outreachWeeklyLimit: 1 }) },
    ]);
    // sentByUserSince = 0; candidate c already received 1 this week.
    prisma.outreachMessage.count.mockImplementation((async (args: { where: { candidateId?: string } }) =>
      args.where.candidateId === 'c' ? 1 : 0) as never);

    const r = await svc.send('o1', 'u1', 'camp1');
    expect(r).toEqual({ sent: 1, heldDailyLimit: 0, heldWeeklyLimit: 1, skipped: 1 });
    expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1', status: OutreachStatus.DRAFT } }),
    );
    expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
    expect((notifications.sendEmail.mock.calls[0] as unknown as string[])[0]).toBe('user-a');
    expect((notifications.sendEmail.mock.calls[0] as unknown as string[])[3]).toContain('/opportunities/unsubscribe?u=user-a');
  });

  it('send: stops at the daily limit per recruiter', async () => {
    const { svc, prisma, notifications } = setup();
    prisma.outreachCampaign.findFirst.mockResolvedValue({ id: 'camp1', orgId: 'o1', jobId: 'j1', status: OutreachCampaignStatus.ACTIVE, followUpDays: [3, 7] });
    prisma.outreachMessage.findMany.mockResolvedValue([
      { id: 'm1', score: 90, body: 'Hi', candidateProfile: { id: 'a', userId: 'ua', recruiterContact: 'ANYONE', outreachWeeklyLimit: 3, openToStaffing: false, deletedAt: null, deactivatedAt: null, isInternalTestAccount: false } },
    ]);
    prisma.outreachMessage.count.mockImplementation((async (args: { where: { sentByUserId?: string } }) => (args.where.sentByUserId ? 50 : 0)) as never);
    const r = await svc.send('o1', 'u1', 'camp1');
    expect(r).toEqual({ sent: 0, heldDailyLimit: 1, heldWeeklyLimit: 0, skipped: 0 });
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('send refuses a paused campaign', async () => {
    const { svc, prisma } = setup();
    prisma.outreachCampaign.findFirst.mockResolvedValue({ id: 'camp1', orgId: 'o1', jobId: 'j1', status: OutreachCampaignStatus.PAUSED, followUpDays: [3, 7] });
    await expect(svc.send('o1', 'u1', 'camp1')).rejects.toThrow(/Resume/);
  });

  it('recruiters see candidates anonymised, and contact details only after Interested', async () => {
    const { svc, prisma } = setup();
    const p = (id: string) => ({
      id,
      fullName: 'Real Name',
      headline: 'Headline',
      roleTitle: null,
      roleTitleOther: null,
      yearsOfExp: 3,
      locationCity: 'Pune',
      locationRegion: null,
      locationCountry: 'IN',
      locationLegacy: null,
      user: { email: 'x@example.com', phone: '+91999' },
    });
    prisma.outreachCampaign.findFirst.mockResolvedValue({
      id: 'camp1',
      status: OutreachCampaignStatus.ACTIVE,
      createdAt: new Date(),
      followUpDays: [3, 7],
      job: { id: 'j1', title: 'ML Engineer', status: JobStatus.LIVE },
      organization: { type: OrgType.STAFFING },
      messages: [
        { id: 'm1', status: OutreachStatus.SENT, candidateProfile: p('aaaaaaaa-1111'), score: 80, body: 'x' },
        { id: 'm2', status: OutreachStatus.INTERESTED, candidateProfile: p('bbbbbbbb-2222'), score: 70, body: 'y' },
      ],
    });
    const c = await svc.getCampaign('o1', 'u1', 'camp1');
    expect(c.messages[0].candidate.name).toBeNull();
    expect(c.messages[0].contact).toBeNull();
    expect(c.messages[0].candidate.ref).toBe('C-AAAAAA');
    expect(c.messages[1].candidate.name).toBe('Real Name');
    expect(c.messages[1].contact).toEqual({ email: 'x@example.com', phone: '+91999' });
    expect(c.counts).toMatchObject({ sent: 2, awaiting: 1, interested: 1 });
  });
});
