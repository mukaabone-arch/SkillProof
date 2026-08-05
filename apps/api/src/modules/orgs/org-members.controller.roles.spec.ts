import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { OrgMembersController } from './org-members.controller';

/**
 * Same pattern as employer-assessment-requests.controller.roles.spec.ts —
 * exercises the real @Roles metadata through the real RolesGuard. Every
 * mutation here (invite/remove/promote/demote/revokeInvitation) must be
 * admin-only; list must stay open to both roles (a member can see the
 * team, just not manage it).
 */
function contextFor(handler: (...args: never[]) => unknown, role: Role): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => OrgMembersController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'user-1', role } }) }),
  } as unknown as ExecutionContext;
}

describe('OrgMembersController — role gating', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = OrgMembersController.prototype;

  const mutations: (keyof OrgMembersController)[] = ['invite', 'revokeInvitation', 'remove', 'promote', 'demote'];

  it.each(mutations)('blocks EMPLOYER_MEMBER from %s', (name) => {
    expect(() => guard.canActivate(contextFor(proto[name] as never, Role.EMPLOYER_MEMBER))).toThrow(
      'Insufficient permissions',
    );
  });

  it.each(mutations)('allows EMPLOYER_ADMIN to %s', (name) => {
    expect(guard.canActivate(contextFor(proto[name] as never, Role.EMPLOYER_ADMIN))).toBe(true);
  });

  it('allows EMPLOYER_MEMBER to list the team', () => {
    expect(guard.canActivate(contextFor(proto.list, Role.EMPLOYER_MEMBER))).toBe(true);
  });

  it('allows EMPLOYER_ADMIN to list the team', () => {
    expect(guard.canActivate(contextFor(proto.list, Role.EMPLOYER_ADMIN))).toBe(true);
  });
});
