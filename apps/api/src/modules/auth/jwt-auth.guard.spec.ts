import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

/** Minimal JwtService stand-in — only verifyAsync is ever called. */
function fakeJwt(payload: { sub: string; role: string } | Error) {
  return {
    verifyAsync: jest.fn(async () => {
      if (payload instanceof Error) throw payload;
      return payload;
    }),
  } as never;
}

function contextWithAuthHeader(header: string | undefined) {
  const req: { headers: { authorization?: string }; user?: unknown } = { headers: {} };
  if (header) req.headers.authorization = header;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('rejects a request with no bearer token before ever touching candidate verification', async () => {
    const candidateVerification = { canActivate: jest.fn() } as never;
    const guard = new JwtAuthGuard(fakeJwt({ sub: 'u1', role: 'CANDIDATE' }), candidateVerification);
    await expect(guard.canActivate(contextWithAuthHeader(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
    expect((candidateVerification as { canActivate: jest.Mock }).canActivate).not.toHaveBeenCalled();
  });

  it('rejects an invalid/expired token before ever touching candidate verification', async () => {
    const candidateVerification = { canActivate: jest.fn() } as never;
    const guard = new JwtAuthGuard(fakeJwt(new Error('bad token')), candidateVerification);
    await expect(guard.canActivate(contextWithAuthHeader('Bearer bad'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect((candidateVerification as { canActivate: jest.Mock }).canActivate).not.toHaveBeenCalled();
  });

  it('delegates to CandidateVerificationGuard once the token verifies, and returns its result', async () => {
    const canActivate = jest.fn(async () => true);
    const guard = new JwtAuthGuard(fakeJwt({ sub: 'u1', role: 'CANDIDATE' }), { canActivate } as never);
    const context = contextWithAuthHeader('Bearer good');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(canActivate).toHaveBeenCalledWith(context);
  });

  it('propagates a rejection thrown by CandidateVerificationGuard (e.g. the incomplete-verification error)', async () => {
    const err = new Error('incomplete verification');
    const canActivate = jest.fn(async () => {
      throw err;
    });
    const guard = new JwtAuthGuard(fakeJwt({ sub: 'u1', role: 'CANDIDATE' }), { canActivate } as never);
    await expect(guard.canActivate(contextWithAuthHeader('Bearer good'))).rejects.toBe(err);
  });

  it('sets req.user from the verified token payload before delegating', async () => {
    const req: { headers: { authorization: string }; user?: unknown } = {
      headers: { authorization: 'Bearer good' },
    };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    const canActivate = jest.fn(async () => true);
    const guard = new JwtAuthGuard(fakeJwt({ sub: 'u1', role: 'CANDIDATE' }), { canActivate } as never);
    await guard.canActivate(context);
    expect(req.user).toEqual({ sub: 'u1', role: 'CANDIDATE' });
  });
});
