import { BadRequestException, HttpException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HelpAnswerInput, LlmService } from '../../llm/llm.service';
import { DAILY_QUESTION_LIMIT, HelpAssistantService, validateConversation } from './help-assistant.service';
import { HELP_GUIDES } from './help-guides.generated';
import { guideHash } from './help-library';
import { FIXTURE } from './help-library.spec';

type Cached = { answer: string; covered: boolean; sectionIds: string[] } | null;

function setup(opts: { orgType?: 'EMPLOYER' | 'STAFFING' | null; todayCount?: number; cached?: Cached } = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    helpQuestion: {
      count: jest.fn(async () => opts.todayCount ?? 0),
      findFirst: jest.fn(async () => opts.cached ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'hq-1' };
      }),
      deleteMany: jest.fn(async () => ({ count: 3 })),
    },
    orgMember: {
      findUnique: jest.fn(async () =>
        opts.orgType === null ? null : { organization: { type: opts.orgType ?? 'EMPLOYER' } },
      ),
    },
  };
  const calls: HelpAnswerInput[] = [];
  const firstCandidateId = HELP_GUIDES.candidate.sections[0].id;
  const llm = {
    answerHelpQuestion: jest.fn(async (input: HelpAnswerInput) => {
      calls.push(input);
      return { answer: 'Here is how.', covered: true, sectionIds: [input.sectionIds[0]] };
    }),
  };
  const svc = new HelpAssistantService(prisma as unknown as PrismaService, llm as unknown as LlmService);
  // Start every test without a library; the library tests install one.
  svc.useLibraries({});
  return { svc, prisma, llm, calls, created, firstCandidateId };
}

const ask = (content: string) => ({ messages: [{ role: 'user' as const, content }] });

describe('HelpAssistantService', () => {
  it('answers a candidate from the candidate guide and stores the question', async () => {
    const { svc, calls, created, firstCandidateId } = setup();
    const res = await svc.ask('u1', Role.CANDIDATE, ask('How do retakes work?'));

    expect(calls[0].audience).toBe('candidate');
    expect(calls[0].guide).toBe(HELP_GUIDES.candidate.markdown);
    expect(res).toEqual({
      id: 'hq-1',
      answer: 'Here is how.',
      covered: true,
      sources: [{ id: firstCandidateId, label: HELP_GUIDES.candidate.sections[0].label }],
      guidePath: '/help/candidate',
      source: 'live',
    });
    expect(created[0]).toMatchObject({
      userId: 'u1',
      audience: 'CANDIDATE',
      platform: 'web',
      question: 'How do retakes work?',
      covered: true,
    });
  });

  it('gives staffing-agency users the recruiter guide and other employers the employer guide', async () => {
    const staffing = setup({ orgType: 'STAFFING' });
    expect((await staffing.svc.ask('u2', Role.EMPLOYER_MEMBER, ask('How do submissions work?'))).guidePath).toBe('/help/recruiter');
    expect(staffing.calls[0].guide).toBe(HELP_GUIDES.recruiter.markdown);

    const employer = setup({ orgType: 'EMPLOYER' });
    expect((await employer.svc.ask('u3', Role.EMPLOYER_ADMIN, ask('How do I post a job?'))).guidePath).toBe('/help/employer');
  });

  it('ignores a requested audience unless the user is a platform admin', async () => {
    const { svc } = setup();
    expect((await svc.ask('u1', Role.CANDIDATE, { ...ask('hi'), audience: 'recruiter' })).guidePath).toBe('/help/candidate');
    expect((await svc.ask('a1', Role.PLATFORM_ADMIN, { ...ask('hello'), audience: 'recruiter' })).guidePath).toBe('/help/recruiter');
  });

  it('on iOS removes paid-plan text from the guide and tells the model to avoid the topic', async () => {
    const { svc, calls, created } = setup();
    await svc.ask('u1', Role.CANDIDATE, { ...ask('What does it cost?'), platform: 'ios' });

    expect(calls[0].noPaidPlans).toBe(true);
    expect(calls[0].guide).not.toMatch(/paid plan|purchases launch/i);
    expect(created[0]).toMatchObject({ platform: 'ios' });
  });

  it('refuses once the daily limit is reached, without calling the model', async () => {
    const { svc, llm } = setup({ todayCount: DAILY_QUESTION_LIMIT });
    await expect(svc.ask('u1', Role.CANDIDATE, ask('Another one'))).rejects.toBeInstanceOf(HttpException);
    expect(llm.answerHelpQuestion).not.toHaveBeenCalled();
  });

  it('throttles rapid-fire questions from the same user', async () => {
    const { svc } = setup();
    await svc.ask('u1', Role.CANDIDATE, ask('First'));
    await expect(svc.ask('u1', Role.CANDIDATE, ask('Second'))).rejects.toBeInstanceOf(HttpException);
    // A different user is unaffected.
    await expect(svc.ask('u9', Role.CANDIDATE, ask('Mine'))).resolves.toBeDefined();
  });

  it("hides the AI provider's error from the user and stores nothing", async () => {
    const { svc, llm, created } = setup();
    llm.answerHelpQuestion.mockRejectedValueOnce(new Error('Anthropic API error: 401 invalid x-api-key'));
    const err = (await svc.ask('u1', Role.CANDIDATE, ask('Hello?')).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/isn't available right now/);
    expect(err.message).not.toMatch(/x-api-key|Anthropic/);
    expect(created).toHaveLength(0);
  });

  it('purges questions older than the retention window', async () => {
    const { svc, prisma } = setup();
    await svc.purgeOld();
    const where = (prisma.helpQuestion.deleteMany.mock.calls[0] as unknown as [{ where: { createdAt: { lt: Date } } }])[0].where;
    const ageDays = (Date.now() - where.createdAt.lt.getTime()) / 86_400_000;
    expect(Math.round(ageDays)).toBe(90);
  });
});

describe('HelpAssistantService answer tiers', () => {
  const currentLibrary = () => ({ candidate: { guideHash: guideHash(HELP_GUIDES.candidate.markdown), entries: FIXTURE } });

  it('answers a close match from the library without calling the model', async () => {
    const { svc, llm, created } = setup();
    svc.useLibraries(currentLibrary());
    const res = await svc.ask('u1', Role.CANDIDATE, ask('failed my test, what now?'));

    expect(res).toMatchObject({ answer: 'Yes. You can retake...', source: 'library', covered: true });
    expect(res.sources.map((s) => s.id)).toEqual(['retakes']);
    expect(llm.answerHelpQuestion).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({ source: 'library' });
  });

  it('ignores a library written from an older guide', async () => {
    const { svc, llm } = setup();
    svc.useLibraries({ candidate: { guideHash: 'old', entries: FIXTURE } });
    expect((await svc.ask('u1', Role.CANDIDATE, ask('failed my test, what now?'))).source).toBe('live');
    expect(llm.answerHelpQuestion).toHaveBeenCalled();
  });

  it('never serves a library answer about paid plans on iOS', async () => {
    const { svc, llm } = setup();
    svc.useLibraries({
      candidate: {
        guideHash: guideHash(HELP_GUIDES.candidate.markdown),
        entries: [{ ...FIXTURE[0], answer: 'Unlimited until skill purchases launch.' }],
      },
    });
    const res = await svc.ask('u1', Role.CANDIDATE, { ...ask('Can I retake an assessment?'), platform: 'ios' });
    expect(res.source).toBe('live');
    expect(llm.answerHelpQuestion).toHaveBeenCalled();
  });

  it('reuses an earlier live answer to the same question while the guide is unchanged', async () => {
    const { svc, llm, prisma, created } = setup({ cached: { answer: 'Earlier answer', covered: true, sectionIds: ['jobs'] } });
    const res = await svc.ask('u1', Role.CANDIDATE, ask('How does matching work?'));

    expect(res).toMatchObject({ answer: 'Earlier answer', source: 'cache' });
    expect(llm.answerHelpQuestion).not.toHaveBeenCalled();
    const where = (prisma.helpQuestion.findFirst.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({
      audience: 'CANDIDATE',
      normalizedQuestion: 'match work',
      guideHash: guideHash(HELP_GUIDES.candidate.markdown),
      source: 'live',
      platform: { in: ['web', 'android'] },
    });
    expect(created[0]).toMatchObject({ source: 'cache', normalizedQuestion: 'match work' });
  });

  it('sends follow-ups live and never caches them', async () => {
    const { svc, llm, prisma, created } = setup({ cached: { answer: 'x', covered: true, sectionIds: [] } });
    svc.useLibraries(currentLibrary());
    await svc.ask('u1', Role.CANDIDATE, {
      messages: [
        { role: 'user', content: 'How do I get my first verified badge?' },
        { role: 'assistant', content: 'Open Assessments...' },
        { role: 'user', content: 'Can I retake an assessment?' },
      ],
    });
    expect(llm.answerHelpQuestion).toHaveBeenCalled();
    expect(prisma.helpQuestion.findFirst).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({ source: 'live', normalizedQuestion: null });
  });

  it('never caches a question with personal details', async () => {
    const { svc, prisma, created } = setup();
    await svc.ask('u1', Role.CANDIDATE, ask('Why is 9876543210 not accepted as my phone?'));
    expect(prisma.helpQuestion.findFirst).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({ normalizedQuestion: null });
  });

  it('counts only live answers toward the daily limit, and lets library answers through at the limit', async () => {
    const { svc, prisma } = setup({ todayCount: DAILY_QUESTION_LIMIT });
    svc.useLibraries(currentLibrary());
    expect((await svc.ask('u1', Role.CANDIDATE, ask('remove my account'))).source).toBe('library');

    await expect(svc.ask('u2', Role.CANDIDATE, ask('What is a portfolio page?'))).rejects.toBeInstanceOf(HttpException);
    const where = (prisma.helpQuestion.count.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ source: 'live' });
  });
});

describe('validateConversation', () => {
  it('accepts a question, and a follow-up after an answer', () => {
    expect(() => validateConversation([{ role: 'user', content: 'q' }])).not.toThrow();
    expect(() =>
      validateConversation([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'q2' },
      ]),
    ).not.toThrow();
  });

  it('rejects conversations that do not end with a question, skip turns, or run long', () => {
    expect(() => validateConversation([{ role: 'assistant', content: 'a' }])).toThrow(BadRequestException);
    expect(() =>
      validateConversation([
        { role: 'user', content: 'q' },
        { role: 'user', content: 'q2' },
      ]),
    ).toThrow(BadRequestException);
    expect(() => validateConversation([{ role: 'user', content: '' }])).toThrow(BadRequestException);
    expect(() => validateConversation([{ role: 'user', content: 'x'.repeat(1001) }])).toThrow(BadRequestException);
  });
});
