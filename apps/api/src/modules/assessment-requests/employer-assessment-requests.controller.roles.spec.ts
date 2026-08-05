import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { EmployerAssessmentRequestsController } from './employer-assessment-requests.controller';

/**
 * Exercises the real @Roles metadata on the real controller class through
 * the real RolesGuard — not a re-implementation of the rule, a check that
 * the rule is actually attached where this task needs it: initiate/verify
 * (the $5 paid-assessment trigger, which spends the organization's money)
 * are admin-only; list/get (read-only visibility) stay open to both roles.
 */
function contextFor(handler: (...args: never[]) => unknown, role: Role): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => EmployerAssessmentRequestsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'user-1', role } }) }),
  } as unknown as ExecutionContext;
}

describe('EmployerAssessmentRequestsController — role gating', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = EmployerAssessmentRequestsController.prototype;

  it('blocks EMPLOYER_MEMBER from initiating a paid assessment request', () => {
    expect(() => guard.canActivate(contextFor(proto.initiate, Role.EMPLOYER_MEMBER))).toThrow(
      'Insufficient permissions',
    );
  });

  it('blocks EMPLOYER_MEMBER from verifying/completing the payment', () => {
    expect(() => guard.canActivate(contextFor(proto.verify, Role.EMPLOYER_MEMBER))).toThrow(
      'Insufficient permissions',
    );
  });

  it('allows EMPLOYER_ADMIN to initiate and verify', () => {
    expect(guard.canActivate(contextFor(proto.initiate, Role.EMPLOYER_ADMIN))).toBe(true);
    expect(guard.canActivate(contextFor(proto.verify, Role.EMPLOYER_ADMIN))).toBe(true);
  });

  it('still allows EMPLOYER_MEMBER to list and get — read-only visibility stays shared', () => {
    expect(guard.canActivate(contextFor(proto.list, Role.EMPLOYER_MEMBER))).toBe(true);
    expect(guard.canActivate(contextFor(proto.get, Role.EMPLOYER_MEMBER))).toBe(true);
  });
});
