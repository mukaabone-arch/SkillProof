import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrgMemberGuard } from './org-member.guard';

function contextFor(userId: string) {
  const req: { user: { sub: string }; orgId?: string } = { user: { sub: userId } };
  return {
    context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext,
    req,
  };
}

describe('OrgMemberGuard', () => {
  it('rejects a user with no OrgMember row, never reaching OrgActiveGuard', async () => {
    const findUnique = jest.fn(async () => null);
    const prisma = { orgMember: { findUnique } } as never;
    const orgActive = { canActivate: jest.fn() } as never;
    const guard = new OrgMemberGuard(prisma, orgActive);

    const { context } = contextFor('user-1');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect((orgActive as { canActivate: jest.Mock }).canActivate).not.toHaveBeenCalled();
  });

  it('sets req.orgId and delegates to OrgActiveGuard once membership resolves', async () => {
    const findUnique = jest.fn(async () => ({ organizationId: 'org-9' }));
    const prisma = { orgMember: { findUnique } } as never;
    const canActivate = jest.fn(async () => true);
    const guard = new OrgMemberGuard(prisma, { canActivate } as never);

    const { context, req } = contextFor('user-1');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.orgId).toBe('org-9');
    expect(canActivate).toHaveBeenCalledWith(context);
  });

  it('propagates OrgActiveGuard rejecting a deactivated org', async () => {
    const findUnique = jest.fn(async () => ({ organizationId: 'org-9' }));
    const prisma = { orgMember: { findUnique } } as never;
    const err = new ForbiddenException({ code: 'ORG_DEACTIVATED' });
    const canActivate = jest.fn(async () => {
      throw err;
    });
    const guard = new OrgMemberGuard(prisma, { canActivate } as never);

    const { context } = contextFor('user-1');
    await expect(guard.canActivate(context)).rejects.toBe(err);
  });
});
