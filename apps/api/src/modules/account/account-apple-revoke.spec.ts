import { AccountService } from './account.service';

/**
 * Sign in with Apple grants are revoked on account deletion (App Store
 * 5.1.1(v)), best-effort. Exercises AccountService's private helper directly
 * — the full delete() path is covered by the existing account specs.
 */
describe('AccountService — Apple revocation on delete', () => {
  function make(rows: { providerRefreshToken: string | null }[] | Error, revokeImpl = jest.fn().mockResolvedValue(true)) {
    const findMany = jest.fn(() => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)));
    const prisma = { identity: { findMany } } as any;
    const apple = { revoke: revokeImpl } as any;
    const svc = new AccountService(prisma, {} as any, {} as any, {} as any, {} as any, apple);
    return { svc, findMany, revoke: revokeImpl };
  }

  it('revokes every stored Apple refresh token', async () => {
    const { svc, findMany, revoke } = make([{ providerRefreshToken: 'r1' }, { providerRefreshToken: 'r2' }]);
    await (svc as any).revokeAppleSignIn('u1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', provider: 'APPLE' }) }),
    );
    expect(revoke.mock.calls.map((c: unknown[]) => c[0])).toEqual(['r1', 'r2']);
  });

  it('does nothing for a user without Apple sign-in', async () => {
    const { svc, revoke } = make([]);
    await (svc as any).revokeAppleSignIn('u1');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('never throws, even if the lookup fails', async () => {
    const { svc } = make(new Error('db down'));
    await expect((svc as any).revokeAppleSignIn('u1')).resolves.toBeUndefined();
  });

  it('is a no-op when the provider is not wired', async () => {
    const svc = new AccountService({} as any, {} as any, {} as any, {} as any, {} as any);
    await expect((svc as any).revokeAppleSignIn('u1')).resolves.toBeUndefined();
  });
});
