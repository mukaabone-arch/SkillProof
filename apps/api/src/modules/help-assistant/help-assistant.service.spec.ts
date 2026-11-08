import { BadRequestException, HttpException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HelpAnswerInput, LlmService } from '../../llm/llm.service';
import { DAILY_QUESTION_LIMIT, HelpAssistantService, validateConversation } from './help-assistant.service';
import { HELP_GUIDES } from './help-guides.generated';

function setup(opts: { orgType?: 'EMPLOYER' | 'STAFFING' | null; todayCount?: number } = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    helpQuestion: {
      count: jest.fn(async () => opts.todayCount ?? 0),
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

  it('purges questions older than the retention window', async () => {
    const { svc, prisma } = setup();
    await svc.purgeOld();
    const where = (prisma.helpQuestion.deleteMany.mock.calls[0] as unknown as [{ where: { createdAt: { lt: Date } } }])[0].where;
    const ageDays = (Date.now() - where.createdAt.lt.getTime()) / 86_400_000;
    expect(Math.round(ageDays)).toBe(90);
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
