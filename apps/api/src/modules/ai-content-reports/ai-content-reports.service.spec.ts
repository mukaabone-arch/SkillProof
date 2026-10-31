import { HttpException, NotFoundException } from '@nestjs/common';
import { AiContentReportStatus, AiContentTarget, AiContentReportReason } from '@prisma/client';
import { AiContentReportsService, DAILY_REPORT_LIMIT } from './ai-content-reports.service';

const SESSION = '11111111-1111-4111-8111-111111111111';

function makePrisma(over: Record<string, any> = {}) {
  const created: any[] = [];
  const prisma: any = {
    assessmentSession: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1' }) },
    aiContentReport: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }) => {
        created.push(data);
        return { id: 'r1', status: AiContentReportStatus.OPEN };
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn(async ({ data }) => ({ id: 'r1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    sessionTurn: { findFirst: jest.fn().mockResolvedValue({ role: 'ASSESSOR', content: 'AI question text' }) },
    liveClaimFeedback: {
      findFirst: jest.fn().mockResolvedValue({ id: 'f1', sessionId: SESSION, summary: 'Good', strengths: ['a'], gaps: [] }),
    },
    claimVerdict: { findFirst: jest.fn().mockResolvedValue({ reason: 'AI reason text' }) },
    ...over,
  };
  return { prisma, created };
}

const base = { sessionId: SESSION, reason: AiContentReportReason.OFFENSIVE };

describe('AiContentReportsService', () => {
  it('reports an AI interviewer message and snapshots its text', async () => {
    const { prisma, created } = makePrisma();
    const r = await new AiContentReportsService(prisma).create('u1', {
      ...base, targetType: AiContentTarget.ASSESSOR_TURN, targetId: 't1', note: '  rude  ',
    });
    expect(r).toEqual({ id: 'r1', status: 'OPEN', duplicate: false });
    expect(created[0]).toMatchObject({ userId: 'u1', contentSnapshot: 'AI question text', note: 'rude' });
  });

  it("refuses the candidate's own message (not AI content)", async () => {
    const { prisma } = makePrisma({ sessionTurn: { findFirst: jest.fn().mockResolvedValue({ role: 'CANDIDATE', content: 'x' }) } });
    await expect(
      new AiContentReportsService(prisma).create('u1', { ...base, targetType: AiContentTarget.ASSESSOR_TURN, targetId: 't2' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("404s on someone else's session", async () => {
    const { prisma } = makePrisma({ assessmentSession: { findUnique: jest.fn().mockResolvedValue({ userId: 'other' }) } });
    await expect(
      new AiContentReportsService(prisma).create('u1', { ...base, targetType: AiContentTarget.ASSESSOR_TURN, targetId: 't1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('snapshots live feedback content without bookkeeping fields', async () => {
    const { prisma, created } = makePrisma();
    await new AiContentReportsService(prisma).create('u1', { ...base, targetType: AiContentTarget.LIVE_FEEDBACK, targetId: 'f1' });
    const snap = JSON.parse(created[0].contentSnapshot);
    expect(snap).toEqual({ summary: 'Good', strengths: ['a'], gaps: [] });
  });

  it('rejects an unknown claim key for a result reason', async () => {
    const { prisma } = makePrisma();
    await expect(
      new AiContentReportsService(prisma).create('u1', { ...base, targetType: AiContentTarget.RESULT_REASON, targetId: 'NOT_A_CLAIM' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the existing report on a repeat tap', async () => {
    const { prisma } = makePrisma();
    prisma.aiContentReport.findFirst.mockResolvedValue({ id: 'old', status: 'OPEN' });
    const r = await new AiContentReportsService(prisma).create('u1', { ...base, targetType: AiContentTarget.ASSESSOR_TURN, targetId: 't1' });
    expect(r).toEqual({ id: 'old', status: 'OPEN', duplicate: true });
    expect(prisma.aiContentReport.create).not.toHaveBeenCalled();
  });

  it('enforces the daily limit', async () => {
    const { prisma } = makePrisma();
    prisma.aiContentReport.count.mockResolvedValue(DAILY_REPORT_LIMIT);
    const err = await new AiContentReportsService(prisma)
      .create('u1', { ...base, targetType: AiContentTarget.ASSESSOR_TURN, targetId: 't1' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('marks a report reviewed', async () => {
    const { prisma } = makePrisma();
    const r = await new AiContentReportsService(prisma).markReviewed('r1', 'admin1', ' checked ');
    expect(r).toMatchObject({ status: 'REVIEWED', reviewedById: 'admin1', resolutionNote: 'checked' });
  });
});

describe('AiContentReportsService — practice interview feedback', () => {
  it('checks the interview session owner and snapshots that feedback', async () => {
    const { prisma, created } = makePrisma({
      interviewSession: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1' }) },
      interviewAnswerFeedback: {
        findFirst: jest.fn().mockResolvedValue({ summary: 'Clear', strengths: ['s'], improvements: ['i'], missingStarElement: null }),
      },
    });
    await new AiContentReportsService(prisma).create('u1', {
      ...base, targetType: AiContentTarget.MOCK_INTERVIEW_FEEDBACK, targetId: 'fb1',
    });
    expect(prisma.assessmentSession.findUnique).not.toHaveBeenCalled();
    expect(JSON.parse(created[0].contentSnapshot)).toMatchObject({ summary: 'Clear' });
  });

  it("404s on someone else's practice session", async () => {
    const { prisma } = makePrisma({ interviewSession: { findUnique: jest.fn().mockResolvedValue({ userId: 'other' }) } });
    await expect(
      new AiContentReportsService(prisma).create('u1', { ...base, targetType: AiContentTarget.MOCK_INTERVIEW_FEEDBACK, targetId: 'fb1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
