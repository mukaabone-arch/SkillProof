import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { EntitlementRefundInterceptor } from './entitlement-refund.interceptor';
import { EntitlementsService } from './entitlements.service';
import { EntitlementLimitException } from './entitlements.errors';
import { EntitlementChargedRequest, EntitlementCharge } from './entitlement.guard';

function fakeContext(req: EntitlementChargedRequest): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function handlerThatThrows(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) } as CallHandler;
}

function handlerThatSucceeds(value: unknown): CallHandler {
  return { handle: () => of(value) } as CallHandler;
}

function makeReq(charge?: EntitlementCharge): EntitlementChargedRequest {
  return { user: { sub: 'user-1', role: 'CANDIDATE' }, entitlementCharge: charge } as EntitlementChargedRequest;
}

function fakeEntitlements(refundImpl: () => Promise<void> = async () => undefined) {
  return { refund: jest.fn(refundImpl) } as unknown as EntitlementsService & { refund: jest.Mock };
}

describe('EntitlementRefundInterceptor', () => {
  it('refunds on a 4xx thrown downstream (e.g. a validation error)', async () => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'applications', refunded: false });
    const err = new BadRequestException('PROFILE_INCOMPLETE');

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);

    expect(entitlements.refund).toHaveBeenCalledTimes(1);
    expect(entitlements.refund).toHaveBeenCalledWith('user-1', 'applications');
    expect(req.entitlementCharge?.refunded).toBe(true);
  });

  it.each([
    ['NotFoundException (job not found)', new NotFoundException('Job not found')],
    ['ForbiddenException', new ForbiddenException()],
    ['ConflictException (already applied)', new ConflictException('Already applied')],
  ])('refunds on %s', async (_label, err) => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'assessments', refunded: false });

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);
    expect(entitlements.refund).toHaveBeenCalledTimes(1);
  });

  it('does NOT refund on 402 LIMIT_REACHED — no unit was charged for that response', async () => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'assessments', refunded: false });
    const err = new EntitlementLimitException('assessments', 2, new Date());

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);

    expect(entitlements.refund).not.toHaveBeenCalled();
    expect(req.entitlementCharge?.refunded).toBe(false);
  });

  it('does NOT refund on a 5xx — state is uncertain, leave the unit charged', async () => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'assessments', refunded: false });
    const err = new InternalServerErrorException('boom');

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);

    expect(entitlements.refund).not.toHaveBeenCalled();
    expect(req.entitlementCharge?.refunded).toBe(false);
  });

  it('does NOT refund a plain (non-HttpException) error — treated as an unknown 500', async () => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'assessments', refunded: false });
    const err = new Error('unexpected crash');

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);
    expect(entitlements.refund).not.toHaveBeenCalled();
  });

  it('is a no-op when the route never charged anything (no marker on the request)', async () => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq(undefined);
    const err = new BadRequestException('bad');

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);
    expect(entitlements.refund).not.toHaveBeenCalled();
  });

  it('never refunds on a successful response', async () => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'assessments', refunded: false });

    const result = await firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatSucceeds({ id: 'attempt-1' })));

    expect(result).toEqual({ id: 'attempt-1' });
    expect(entitlements.refund).not.toHaveBeenCalled();
  });

  it('does not double-refund when the marker is already refunded', async () => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'assessments', refunded: true }); // already refunded by a prior pass
    const err = new BadRequestException('bad');

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);
    expect(entitlements.refund).not.toHaveBeenCalled();
  });

  it('does not double-refund across two invocations sharing the same request object', async () => {
    const entitlements = fakeEntitlements();
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'assessments', refunded: false });
    const err = new BadRequestException('bad');

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);
    // Same req object, as if the same request's error path were somehow re-entered.
    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);

    expect(entitlements.refund).toHaveBeenCalledTimes(1);
  });

  it('still surfaces the original error even if the refund call itself fails', async () => {
    const entitlements = fakeEntitlements(async () => {
      throw new Error('db unavailable');
    });
    const interceptor = new EntitlementRefundInterceptor(entitlements);
    const req = makeReq({ metric: 'assessments', refunded: false });
    const err = new BadRequestException('bad');

    await expect(firstValueFrom(interceptor.intercept(fakeContext(req), handlerThatThrows(err)))).rejects.toBe(err);
    expect(entitlements.refund).toHaveBeenCalledTimes(1);
  });
});
