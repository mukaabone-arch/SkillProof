import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrgActiveGuard } from './org-active.guard';

function contextFor(orgId: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ orgId }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(deactivatedAt: Date | null) {
  const findUniqueOrThrow = jest.fn(async () => ({ deactivatedAt }));
  const prisma = { organization: { findUniqueOrThrow } } as never;
  return { guard: new OrgActiveGuard(prisma), findUniqueOrThrow };
}

describe('OrgActiveGuard', () => {
  it('allows an active org through', async () => {
    const { guard } = makeGuard(null);
    await expect(guard.canActivate(contextFor('org-1'))).resolves.toBe(true);
  });

  it('blocks a deactivated org with a machine-readable ORG_DEACTIVATED error', async () => {
    const { guard } = makeGuard(new Date());
    await expect(guard.canActivate(contextFor('org-1'))).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(contextFor('org-1'));
      fail('expected canActivate to throw');
    } catch (err) {
      const response = (err as ForbiddenException).getResponse();
      expect(response).toMatchObject({ code: 'ORG_DEACTIVATED' });
    }
  });

  it('looks up the org by req.orgId (set by OrgMemberGuard before this runs)', async () => {
    const { guard, findUniqueOrThrow } = makeGuard(null);
    await guard.canActivate(contextFor('org-42'));
    expect(findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-42' } }));
  });
});
