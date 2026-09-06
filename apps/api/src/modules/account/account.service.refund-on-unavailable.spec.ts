import { AssessmentRequestStatus, TransactionStatus } from '@prisma/client';
import { AccountService } from './account.service';
import { AssessmentRequestsExpiryJob } from '../assessment-requests/assessment-requests-expiry.job';

/**
 * Integration-style: exercises the REAL AssessmentRequestsExpiryJob (not a
 * mock) through AccountService.deactivate/delete, sharing one fake Prisma
 * so both sides observe the same AssessmentRequest row. The point is to
 * verify the *wiring* and the properties that only show up when two
 * trigger paths (an account going unavailable, and the independent hourly
 * expiry sweep) can touch the same row — excludeOne's own unit coverage
 * already lives in assessment-requests-expiry.job.spec.ts; this file
 * doesn't re-test that, it tests that AccountService now reaches it at all.
 *
 * Postpaid (2026-09): there is no payment gateway anywhere in this flow —
 * excluding a request from billing is a pure local status write (the
 * AssessmentRequest to EXPIRED_UNBILLED, its linked Transaction PENDING ->
 * VOIDED), so this file no longer needs a fake Razorpay gateway at all.
 */

interface Row {
  id: string;
  candidateId: string;
  status: AssessmentRequestStatus;
  amount: number | null;
  transactionId: string | null;
  expiresAt: Date | null;
  skill: { name: string };
  candidateProfile: { fullName: string | null };
}

interface TransactionRow {
  id: string;
  status: TransactionStatus;
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
    status: AssessmentRequestStatus.ACCRUED_PENDING_START,
    amount: 17700,
    transactionId: 'txn-1',
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // not yet expired — this candidate becoming unavailable is the only reason exclusion fires
    skill: { name: 'RAG Systems' },
    candidateProfile: { fullName: 'Jordan Lee' },
    ...overrides,
  };
}

function setup(profile: FakeProfile, requests: Row[], transactionRows: TransactionRow[] = [{ id: 'txn-1', status: TransactionStatus.PENDING }]) {
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
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: AssessmentRequestStatus }; data: Partial<Row> }) => {
        const row = requests.find((r) => r.id === where.id && r.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    transaction: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => transactionRows.find((t) => t.id === where.id) ?? null),
    },
  };

  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const transactions = { recordSystemVoid: jest.fn(async () => undefined) };
  const expiryJob = new AssessmentRequestsExpiryJob(prisma as never, notifications as never, transactions as never);
  const subscriptions = { cancelImmediatelyForDeletion: jest.fn(async () => undefined) };
  const account = new AccountService(prisma as never, notifications as never, expiryJob, subscriptions as never, {} as never);

  return { account, expiryJob, prisma, notifications, transactions, requests, accountActions };
}

describe('AccountService — connected to the assessment-request exclusion path', () => {
  it('deleting an account with a pending accrual excludes it from billing', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow()];
    const { account, transactions, requests: reqs } = setup(profile, requests);

    await account.delete('user-1', { confirmation: 'DELETE' });

    expect(transactions.recordSystemVoid).toHaveBeenCalledWith('txn-1');
    expect(reqs[0].status).toBe(AssessmentRequestStatus.EXPIRED_UNBILLED);
  });

  it('deactivating (not just deleting) also triggers exclusion — "unavailable" covers both', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow()];
    const { account, transactions, requests: reqs } = setup(profile, requests);

    await account.deactivate('user-1', {});

    expect(transactions.recordSystemVoid).toHaveBeenCalledTimes(1);
    expect(reqs[0].status).toBe(AssessmentRequestStatus.EXPIRED_UNBILLED);
  });

  it('a request already STARTED (or otherwise not ACCRUED_PENDING_START) is left completely alone', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow({ status: AssessmentRequestStatus.STARTED })];
    const { account, transactions, requests: reqs } = setup(profile, requests);

    await account.delete('user-1', { confirmation: 'DELETE' });

    expect(transactions.recordSystemVoid).not.toHaveBeenCalled();
    expect(reqs[0].status).toBe(AssessmentRequestStatus.STARTED);
  });

  it('idempotent when the account-lifecycle trigger and the independent hourly sweep both reach the same row', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const requests = [requestRow()];
    const { account, expiryJob, transactions, requests: reqs } = setup(profile, requests);

    // The candidate deletes their account — this excludes the request.
    await account.delete('user-1', { confirmation: 'DELETE' });
    expect(transactions.recordSystemVoid).toHaveBeenCalledTimes(1);
    expect(reqs[0].status).toBe(AssessmentRequestStatus.EXPIRED_UNBILLED);

    // The independent hourly sweep later reaches for the same row too (e.g.
    // its own expiresAt also happened to lapse around the same time) —
    // must be a pure no-op.
    await expiryJob.excludeOne('req-1', 'EXPIRED');

    expect(transactions.recordSystemVoid).toHaveBeenCalledTimes(1);
  });

  it('a candidate with no pending accruals deletes cleanly with nothing excluded', async () => {
    const profile: FakeProfile = { id: 'profile-1', userId: 'user-1', deactivatedAt: null, deletedAt: null, fullName: 'Jordan Lee', photoKey: null, resumeS3Key: null };
    const { account, transactions } = setup(profile, []);

    await expect(account.delete('user-1', { confirmation: 'DELETE' })).resolves.toEqual({ deleted: true });
    expect(transactions.recordSystemVoid).not.toHaveBeenCalled();
  });
});
