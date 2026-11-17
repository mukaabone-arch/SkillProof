import { OrgType, OutreachStatus, RecruiterContactPreference } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OutreachCandidateService } from './outreach-candidate.service';
import { OutreachFollowUpJob } from './outreach-follow-up.job';
import { unsubscribeToken } from './outreach.util';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

const message = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  orgId: 'o1',
  campaignId: 'camp1',
  candidateId: 'p1',
  status: OutreachStatus.SENT,
  sentByUserId: 'recruiter1',
  shortlistEntryId: null,
  campaign: {
    jobId: 'j1',
    createdByUserId: 'creator1',
    organization: { name: 'Acme', type: OrgType.EMPLOYER },
    job: { id: 'j1', title: 'ML Engineer' },
  },
  ...over,
});

function setup(m: ReturnType<typeof message> | null = message()) {
  const prisma = {
    candidateProfile: {
      findUnique: jest.fn(async () => ({ id: 'p1', fullName: 'Priya Sharma', recruiterContact: 'ANYONE', outreachWeeklyLimit: 3, openToStaffing: false })),
      update: jest.fn(async () => ({})),
    },
    outreachMessage: {
      findFirst: jest.fn(async () => m),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    outreachEvent: { create: jest.fn(async () => ({})) },
    shortlistEntry: { upsert: jest.fn(async () => ({ id: 'entry1' })) },
  };
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const svc = new OutreachCandidateService(prisma as unknown as PrismaService, notifications as unknown as NotificationsService);
  return { svc, prisma, notifications };
}

describe('OutreachCandidateService', () => {
  it('Interested puts an employer candidate on the job shortlist and tells the sender', async () => {
    const { svc, prisma, notifications } = setup();
    const r = await svc.respond('user1', 'm1', { response: 'INTERESTED', note: 'Free from January' });
    expect(r.status).toBe(OutreachStatus.INTERESTED);
    expect(prisma.shortlistEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_candidateId_jobId: { orgId: 'o1', candidateId: 'p1', jobId: 'j1' } } }),
    );
    expect(prisma.outreachMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ shortlistEntryId: 'entry1', nextFollowUpAt: null, candidateNote: 'Free from January' }) }),
    );
    const [to, , subject] = notifications.sendEmail.mock.calls[0] as unknown as string[];
    expect(to).toBe('recruiter1');
    expect(subject).toBe('Priya Sharma is interested — ML Engineer');
  });

  it('a recruiter org gets no shortlist entry, and no name unless the candidate says Interested', async () => {
    const staffing = message({ campaign: { ...message().campaign, organization: { name: 'Hire Co', type: OrgType.STAFFING } } });
    const a = setup(staffing);
    await a.svc.respond('user1', 'm1', { response: 'NOT_NOW' });
    expect(a.prisma.shortlistEntry.upsert).not.toHaveBeenCalled();
    expect((a.notifications.sendEmail.mock.calls[0] as unknown as string[])[2]).toBe('Candidate C-P1 said not now — ML Engineer');

    const b = setup(staffing);
    await b.svc.respond('user1', 'm1', { response: 'INTERESTED' });
    expect(b.prisma.shortlistEntry.upsert).not.toHaveBeenCalled();
    expect((b.notifications.sendEmail.mock.calls[0] as unknown as string[])[2]).toBe('Priya Sharma is interested — ML Engineer');
  });

  it('refuses answers to drafts, closed campaigns and messages already answered', async () => {
    await expect(setup(message({ status: OutreachStatus.DRAFT })).svc.respond('u', 'm1', { response: 'INTERESTED' })).rejects.toThrow(/not found/);
    await expect(setup(message({ status: OutreachStatus.STOPPED })).svc.respond('u', 'm1', { response: 'INTERESTED' })).rejects.toThrow(/no longer/);
    await expect(setup(message({ status: OutreachStatus.NOT_INTERESTED })).svc.respond('u', 'm1', { response: 'INTERESTED' })).rejects.toThrow(/already/);
  });

  it('"Not now" can still become Interested later', async () => {
    const { svc } = setup(message({ status: OutreachStatus.NOT_NOW }));
    await expect(svc.respond('u', 'm1', { response: 'INTERESTED' })).resolves.toMatchObject({ status: 'INTERESTED' });
  });

  it('turning contact off, in settings or from the email link, cancels pending follow-ups', async () => {
    const a = setup();
    await a.svc.updatePreferences('user1', { recruiterContact: RecruiterContactPreference.OFF });
    expect(a.prisma.outreachMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nextFollowUpAt: null } }),
    );

    const b = setup();
    await expect(b.svc.unsubscribe('user1', 'forged')).rejects.toThrow(/not valid/);
    await b.svc.unsubscribe('user1', unsubscribeToken('user1'));
    expect(b.prisma.candidateProfile.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { recruiterContact: 'OFF' } });
    expect(b.prisma.outreachMessage.updateMany).toHaveBeenCalled();
  });
});

describe('OutreachFollowUpJob', () => {
  const due = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    body: 'Hi Priya',
    sentAt: new Date('2026-11-10T00:00:00Z'),
    followUpsSent: 0,
    campaign: { followUpDays: [3, 7], organization: { name: 'Acme' }, job: { title: 'ML Engineer', status: 'LIVE' } },
    candidateProfile: { userId: 'user1', recruiterContact: RecruiterContactPreference.ANYONE, deletedAt: null, deactivatedAt: null },
    ...over,
  });

  function job(rows: unknown[]) {
    const prisma = {
      outreachMessage: { findMany: jest.fn(async () => rows), updateMany: jest.fn(async () => ({ count: 1 })) },
      outreachEvent: { create: jest.fn(async () => ({})) },
    };
    const notifications = { sendEmail: jest.fn(async () => undefined) };
    return { run: new OutreachFollowUpJob(prisma as unknown as PrismaService, notifications as unknown as NotificationsService), prisma, notifications };
  }

  it('sends the first reminder and schedules the second from the original send', async () => {
    const { run, prisma, notifications } = job([due()]);
    expect(await run.run(new Date('2026-11-13T01:00:00Z'))).toBe(1);
    expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: OutreachStatus.SENT, followUpsSent: 0 },
      data: { followUpsSent: 1, nextFollowUpAt: new Date('2026-11-17T00:00:00Z') },
    });
    expect((notifications.sendEmail.mock.calls[0] as unknown as string[])[2]).toBe('Reminder: Acme would like to hear from you');
  });

  it('stops quietly when the candidate turned contact off', async () => {
    const { run, prisma, notifications } = job([
      due({ candidateProfile: { userId: 'user1', recruiterContact: RecruiterContactPreference.OFF, deletedAt: null, deactivatedAt: null } }),
    ]);
    expect(await run.run(new Date('2026-11-13T01:00:00Z'))).toBe(0);
    expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { nextFollowUpAt: null } }));
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });
});
