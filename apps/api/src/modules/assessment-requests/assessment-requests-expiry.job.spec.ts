import { AssessmentRequestStatus, TransactionStatus } from '@prisma/client';
import { AssessmentRequestsExpiryJob } from './assessment-requests-expiry.job';

function fakePrisma(rows: any[], transactionRows: any[] = []) {
  return {
    assessmentRequest: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matched = rows.filter((r) => matches(r, where));
        for (const r of matched) Object.assign(r, data);
        return { count: matched.length };
      }),
    },
    transaction: {
      findUnique: jest.fn(async ({ where }: any) => transactionRows.find((t) => t.id === where.id) ?? null),
    },
  };

  function matches(row: any, where: any): boolean {
    if (!where) return true;
    if (where.OR) return where.OR.some((clause: any) => matches(row, clause));
    for (const [key, cond] of Object.entries(where)) {
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('lt' in (cond as any) && !(row[key] < (cond as any).lt)) return false;
        if ('gt' in (cond as any) && !(row[key] > (cond as any).gt)) return false;
      } else if (row[key] !== cond) {
        return false;
      }
    }
    return true;
  }
}

function expiredRequest(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'req-1',
    orgId: 'org-1',
    requestedByUserId: 'user-employer-1',
    candidateId: 'candidate-1',
    skillId: 'skill-1',
    level: 'L2',
    status: AssessmentRequestStatus.ACCRUED_PENDING_START,
    amount: 17700,
    transactionId: null,
    expiresAt: new Date(Date.now() - 60_000),
    skill: { name: 'RAG Systems' },
    candidateProfile: { fullName: 'Jordan Lee' },
    ...overrides,
  };
}

function makeJob(rows: any[], transactionRows: any[] = []) {
  const prisma = fakePrisma(rows, transactionRows);
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const transactions = { recordSystemVoid: jest.fn(async () => undefined) };
  const job = new AssessmentRequestsExpiryJob(prisma as any, notifications as any, transactions as any);
  return { job, prisma, notifications, transactions };
}

describe('AssessmentRequestsExpiryJob', () => {
  it('happy path: excludes an expired ACCRUED_PENDING_START row and transitions to EXPIRED_UNBILLED — no payment gateway involved at all', async () => {
    const rows = [expiredRequest()];
    const { job, notifications } = makeJob(rows);

    await job.run();

    expect(rows[0].status).toBe(AssessmentRequestStatus.EXPIRED_UNBILLED);
    expect(notifications.sendEmail).toHaveBeenCalledWith(
      'user-employer-1',
      'ASSESSMENT_REQUEST_EXPIRED',
      expect.any(String),
      expect.any(String),
    );
  });

  it('ignores ACCRUED_PENDING_START rows that have not expired yet', async () => {
    const rows = [expiredRequest({ expiresAt: new Date(Date.now() + 60_000) })];
    const { job } = makeJob(rows);

    await job.run();

    expect(rows[0].status).toBe(AssessmentRequestStatus.ACCRUED_PENDING_START);
  });

  it('never excludes a STARTED request, even if it would otherwise match on age', async () => {
    const rows = [expiredRequest({ status: AssessmentRequestStatus.STARTED })];
    const { job } = makeJob(rows);

    await job.run();

    expect(rows[0].status).toBe(AssessmentRequestStatus.STARTED);
  });

  it('a row already EXPIRED_UNBILLED is not touched again — it does not match the sweep query', async () => {
    const rows = [expiredRequest({ status: AssessmentRequestStatus.EXPIRED_UNBILLED })];
    const { job, prisma } = makeJob(rows);

    await job.run();

    expect(prisma.assessmentRequest.updateMany).not.toHaveBeenCalled();
  });

  describe('start-vs-expiry race', () => {
    it('if the candidate starts between the sweep query and the claim, the claim loses and no exclusion happens', async () => {
      const rows = [expiredRequest()];
      const { job, prisma } = makeJob(rows);

      // Simulate the candidate's own atomic start winning the race right
      // after sweep()'s findMany but before excludeOne()'s claim attempt —
      // by the time excludeOne runs its own conditional updateMany, status
      // is already STARTED, so that updateMany (WHERE status =
      // ACCRUED_PENDING_START) must match zero rows.
      const originalUpdateMany = prisma.assessmentRequest.updateMany;
      let firstCall = true;
      prisma.assessmentRequest.updateMany = jest.fn(async (args: any) => {
        if (firstCall && args.data.status === AssessmentRequestStatus.EXPIRED_UNBILLED) {
          firstCall = false;
          rows[0].status = AssessmentRequestStatus.STARTED; // the "concurrent" start
        }
        return originalUpdateMany(args);
      });

      await job.run();

      expect(rows[0].status).toBe(AssessmentRequestStatus.STARTED);
    });
  });

  describe('ledger sync', () => {
    it('voids the linked Transaction (PENDING -> VOIDED) once the request is excluded', async () => {
      const rows = [expiredRequest({ transactionId: 'txn-1' })];
      const { job, transactions } = makeJob(rows, [{ id: 'txn-1', status: TransactionStatus.PENDING }]);

      await job.run();

      expect(transactions.recordSystemVoid).toHaveBeenCalledWith('txn-1');
    });

    it('does nothing for a row with no linked Transaction (pre-existing rows before this column existed)', async () => {
      const rows = [expiredRequest({ transactionId: null })];
      const { job, transactions } = makeJob(rows);

      await job.run();

      expect(transactions.recordSystemVoid).not.toHaveBeenCalled();
    });

    it('does not attempt to void a Transaction that is not PENDING (already invoiced or already voided)', async () => {
      const rows = [expiredRequest({ transactionId: 'txn-1' })];
      const { job, transactions } = makeJob(rows, [{ id: 'txn-1', status: TransactionStatus.SUCCEEDED }]);

      await job.run();

      expect(transactions.recordSystemVoid).not.toHaveBeenCalled();
    });
  });

  it('one row throwing unexpectedly does not stop the rest of the sweep', async () => {
    const rows = [expiredRequest({ id: 'req-1' }), expiredRequest({ id: 'req-2' })];
    const { job, prisma } = makeJob(rows);
    jest.spyOn(prisma.assessmentRequest, 'findUniqueOrThrow').mockImplementationOnce(async () => {
      throw new Error('unexpected DB blip');
    });

    await job.run();

    expect(rows[1].status).toBe(AssessmentRequestStatus.EXPIRED_UNBILLED);
  });

  describe('excludeOne reused directly (AccountService, on candidate deactivation/deletion)', () => {
    it('excludes an ACCRUED_PENDING_START request immediately, same as the hourly sweep would eventually', async () => {
      const rows = [expiredRequest({ expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) })]; // not expired yet
      const { job } = makeJob(rows);

      await job.excludeOne('req-1', 'CANDIDATE_UNAVAILABLE');

      expect(rows[0].status).toBe(AssessmentRequestStatus.EXPIRED_UNBILLED);
    });

    it('is idempotent — calling it twice for an already-excluded row is a no-op the second time', async () => {
      const rows = [expiredRequest({ status: AssessmentRequestStatus.EXPIRED_UNBILLED })];
      const { job, transactions } = makeJob(rows);

      await job.excludeOne('req-1', 'CANDIDATE_UNAVAILABLE');

      expect(transactions.recordSystemVoid).not.toHaveBeenCalled();
    });
  });
});
