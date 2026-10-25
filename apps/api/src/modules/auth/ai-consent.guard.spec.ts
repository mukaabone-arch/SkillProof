import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AI_CONSENT_REQUIRED, AiConsentGuard } from './ai-consent.guard';

function ctxFor(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: userId } }) }),
  } as unknown as ExecutionContext;
}

function guardWith(aiConsentAt: Date | null | undefined) {
  const findUnique = jest.fn().mockResolvedValue(aiConsentAt === undefined ? null : { aiConsentAt });
  const prisma = { user: { findUnique } } as any;
  return { guard: new AiConsentGuard(prisma), findUnique };
}

describe('AiConsentGuard', () => {
  it('allows a user who has agreed', async () => {
    const { guard, findUnique } = guardWith(new Date('2026-10-25T10:00:00Z'));
    await expect(guard.canActivate(ctxFor('u1'))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { aiConsentAt: true } });
  });

  it('blocks a user who has not agreed, with the AI_CONSENT_REQUIRED code', async () => {
    const { guard } = guardWith(null);
    const err = await guard.canActivate(ctxFor('u1')).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: AI_CONSENT_REQUIRED });
  });

  it('blocks when the user record is missing', async () => {
    const { guard } = guardWith(undefined);
    await expect(guard.canActivate(ctxFor('ghost'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
