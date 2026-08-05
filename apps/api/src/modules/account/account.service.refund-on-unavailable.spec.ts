import { AssessmentRequestStatus } from '@prisma/client';
import { AccountService } from './account.service';
import { AssessmentRequestsRefundJob } from '../assessment-requests/assessment-requests-refund.job';
import { RazorpayGateway } from '../assessment-requests/razorpay-gateway';

/**
 * Integration-style: exercises the REAL AssessmentRequestsRefundJob (not a
 * mock) through AccountService.deactivate/delete, sharing one fake Prisma
 * so both sides observe the same AssessmentRequest row. The point is to
 * verify the *wiring* and the properties that only show up when two
 * trigger paths (an account going unavailable, and the independent hourly
 * expiry sweep) can touch the same row — refundOne's own unit coverage
 * already lives in assessment-requests-refund.job.spec.ts; this file
 * doesn't re-test that, it tests that AccountService now reaches it at all.
 */

interface Row {
  id: string;
  candidateId: string;
  status: AssessmentRequestStatus;
  razorpayPaymentId: string | null;
  razorpayRefundId: string | null;
  amount: number | null;
  expiresAt: Date | null;
  skill: { name: string };
  candidateProfile: { fullName: string | null };
}

interface FakeProfile {
  id: string;
  userId: string;
  deactivatedAt: Date | null;
  deletedAt: Date | null;
  fullName: string | null;
  photoKey: string | null;
  resumeS3Key: string | null;
}

function requestRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'req-1',
    candidateId: 'profile-1',
    status: AssessmentRequestStatus.PAID_PENDING_START,
    razorpayPaymentId: 'pay-1',
    razorpayRefundId: null,
    amount: 50000,
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // not yet expired — this candidate becoming unavailable is the only reason a refund fires
    skill: { name: 'RAG Systems' },
    candidateProfile: { fullName: 'Jordan Lee' },
    ...overrides,
  };
}

function fakeGateway(): jest.Mocked<RazorpayGateway> {
  return {
    createOrder: jest.fn(async (_params: Parameters<RazorpayGateway['createOrder']>[0]) => ({ id: 'unused' })),
    fetchOrder: jest.fn(async (_orderId: string) => ({ notes: null })),
    refundPayment: jest.fn(async (_paymentId: string, _amount: number) => ({ id: 'refund-1' })),
  };
}

function setup(profile: FakeProfile, requests: Row[]) {
  const profiles = [profile];
  const accountActions: unknown[] = [];

  const prisma = {
    candidateProfile: {
      findUnique: jest.fn(async ({ where }: { where: { userId?: string; id?: string } }) => {
        if (where.userId !== undefined) return profiles.find((p) => p.userId === where.userId) ?? null;
        if (where.id !== undefined) return profiles.find((p) => p.id === where.id) ?? null;
        return null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeProfile> }) => {
        const p = profiles.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return p;
      }),
    },
    shortlistEntry: { findMany: jest.fn(async () => []) },
    application: { updateMany: jest.fn(async () => ({ count: 0 })) },
    accountAction: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        accountActions.push(data);
        return data;
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    user: { update: jest.fn(async () => undefined) },
    identity: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    refreshToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    externalCredential: { updateMany: jest.fn(async () => ({ count: 0 })) },
    certification: { updateMany: jest.fn(async () => ({ count: 0 })), findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    assessmentRequest: {
      findMany: jest.fn(async ({ where }: { where: { candidateId: string; status: AssessmentRequestStatus } }) =>
        requests.filter((r) => r.candidateId === where.candidateId && r.status === where.status),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => requests.find((r) => r.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = requests.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = requests.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: AssessmentRequestStatus }; data: Partial<Row> }) => {
        const row = requests.find((r) => r.id === where.id && r.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };

  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const gateway = fakeGateway();
  const refundJob = new AssessmentRequestsRefundJob(prisma as never, notifications as never, gateway);
  const account = new AccountService(prisma as never, notifications as never, refundJob);

  return { account, refundJob, prisma, notifications, gateway, requests, accountActions };
}

describe('AccountService — connected to the assessment-request refund path', () => {
  it('deleting an account with a pending paid request issues a real refund', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow()];
    const { account, gateway, requests: reqs } = setup(profile, requests);

    await account.delete('user-1', { confirmation: 'DELETE' });

    expect(gateway.refundPayment).toHaveBeenCalledWith('pay-1', 50000);
    expect(reqs[0].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);
    expect(reqs[0].razorpayRefundId).toBe('refund-1');
  });

  it('deactivating (not just deleting) also triggers the refund — "unavailable" covers both', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow()];
    const { account, gateway, requests: reqs } = setup(profile, requests);

    await account.deactivate('user-1', {});

    expect(gateway.refundPayment).toHaveBeenCalledTimes(1);
    expect(reqs[0].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);
  });

  it('a request already STARTED (or otherwise not PAID_PENDING_START) is left completely alone', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow({ status: AssessmentRequestStatus.STARTED })];
    const { account, gateway, requests: reqs } = setup(profile, requests);

    await account.delete('user-1', { confirmation: 'DELETE' });

    expect(gateway.refundPayment).not.toHaveBeenCalled();
    expect(reqs[0].status).toBe(AssessmentRequestStatus.STARTED);
  });

  it('double-refund guard holds when the account-lifecycle trigger and the independent hourly sweep both reach the same row', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow()];
    const { account, refundJob, gateway, requests: reqs } = setup(profile, requests);

    // The candidate deletes their account — this refunds the request.
    await account.delete('user-1', { confirmation: 'DELETE' });
    expect(gateway.refundPayment).toHaveBeenCalledTimes(1);
    expect(reqs[0].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);

    // The independent hourly sweep later reaches for the same row too (e.g.
    // its own expiresAt also happened to lapse around the same time) —
    // must be a pure no-op, never a second call to Razorpay.
    await refundJob.refundOne('req-1', 'EXPIRED');

    expect(gateway.refundPayment).toHaveBeenCalledTimes(1);
    expect(reqs[0].razorpayRefundId).toBe('refund-1');
  });

  it('a Razorpay failure during the account-lifecycle trigger lands the request at REFUND_FAILED, not silently dropped — and a later retry recovers it', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow()];
    const { account, refundJob, gateway, requests: reqs } = setup(profile, requests);
    gateway.refundPayment.mockRejectedValueOnce(new Error('Razorpay outage'));

    await account.delete('user-1', { confirmation: 'DELETE' });

    expect(reqs[0].status).toBe(AssessmentRequestStatus.REFUND_FAILED);
    expect(reqs[0].razorpayRefundId).toBeNull();

    // The next hourly sweep retries every REFUND_FAILED row — simulated
    // directly here via the same refundOne the sweep itself calls.
    await refundJob.refundOne('req-1', 'EXPIRED');

    expect(reqs[0].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);
    expect(reqs[0].razorpayRefundId).toBe('refund-1');
    expect(gateway.refundPayment).toHaveBeenCalledTimes(2);
  });

  it('a candidate with no pending paid requests deletes cleanly with no refund attempted', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const { account, gateway } = setup(profile, []);

    await expect(account.delete('user-1', { confirmation: 'DELETE' })).resolves.toEqual({ deleted: true });
    expect(gateway.refundPayment).not.toHaveBeenCalled();
  });
});
