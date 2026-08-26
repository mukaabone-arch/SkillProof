import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { CandidateVerificationGuard } from './candidate-verification.guard';
import { AuthController } from './auth.controller';
import { AccountController } from '../account/account.controller';
import { UsersController } from '../users/users.controller';
import { ProfilesController } from '../profiles/profiles.controller';

/**
 * Same pattern as org-members.controller.roles.spec.ts — exercises the real
 * @SkipVerificationGate metadata (via the real Reflector) against the real
 * controller classes, so this fails if the decorator is ever removed from
 * AuthController/AccountController/UsersController.me, or if a genuinely
 * gated controller (ProfilesController stands in for "any ordinary
 * candidate controller") is accidentally exempted.
 */
function contextFor(
  handler: (...args: never[]) => unknown,
  klass: object,
  role: Role,
  sub = 'user-1',
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => klass,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub, role } }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(user: { phone: string | null; email: string | null } | null) {
  const findUnique = jest.fn(async () => user);
  const prisma = { user: { findUnique } } as never;
  const guard = new CandidateVerificationGuard(new Reflector(), prisma);
  return { guard, findUnique };
}

describe('CandidateVerificationGuard', () => {
  it('never queries the DB for a non-candidate role', async () => {
    const { guard, findUnique } = makeGuard({ phone: null, email: null });
    const result = await guard.canActivate(
      contextFor(ProfilesController.prototype.me, ProfilesController, Role.EMPLOYER_ADMIN),
    );
    expect(result).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('never queries the DB for PLATFORM_ADMIN', async () => {
    const { guard, findUnique } = makeGuard({ phone: null, email: null });
    const result = await guard.canActivate(
      contextFor(ProfilesController.prototype.me, ProfilesController, Role.PLATFORM_ADMIN),
    );
    expect(result).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('allows a fully-verified candidate through a gated controller', async () => {
    const { guard } = makeGuard({ phone: '+15551234', email: 'a@b.com' });
    const result = await guard.canActivate(
      contextFor(ProfilesController.prototype.me, ProfilesController, Role.CANDIDATE),
    );
    expect(result).toBe(true);
  });

  it('blocks a phone-only candidate on an ordinary gated controller (ProfilesController)', async () => {
    const { guard } = makeGuard({ phone: '+15551234', email: null });
    await expect(
      guard.canActivate(contextFor(ProfilesController.prototype.me, ProfilesController, Role.CANDIDATE)),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('blocks an email-only candidate on an ordinary gated controller (ProfilesController)', async () => {
    const { guard } = makeGuard({ phone: null, email: 'a@b.com' });
    await expect(
      guard.canActivate(contextFor(ProfilesController.prototype.me, ProfilesController, Role.CANDIDATE)),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('passes through if the user has vanished between token issue and this request', async () => {
    const { guard } = makeGuard(null);
    const result = await guard.canActivate(
      contextFor(ProfilesController.prototype.me, ProfilesController, Role.CANDIDATE),
    );
    expect(result).toBe(true);
  });

  it('exempts AuthController (class-level @SkipVerificationGate) even for an incomplete candidate', async () => {
    const { guard, findUnique } = makeGuard({ phone: null, email: null });
    const result = await guard.canActivate(
      contextFor(AuthController.prototype.requestOtp, AuthController, Role.CANDIDATE),
    );
    expect(result).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('exempts AccountController (class-level @SkipVerificationGate) even for an incomplete candidate', async () => {
    const { guard, findUnique } = makeGuard({ phone: null, email: null });
    const result = await guard.canActivate(
      contextFor(AccountController.prototype.delete, AccountController, Role.CANDIDATE),
    );
    expect(result).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('exempts UsersController.me (method-level @SkipVerificationGate) even for an incomplete candidate', async () => {
    const { guard, findUnique } = makeGuard({ phone: null, email: null });
    const result = await guard.canActivate(
      contextFor(UsersController.prototype.me, UsersController, Role.CANDIDATE),
    );
    expect(result).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
