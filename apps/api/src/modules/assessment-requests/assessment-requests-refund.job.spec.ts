import { AssessmentRequestStatus } from '@prisma/client';
import { AssessmentRequestsRefundJob } from './assessment-requests-refund.job';
import { RazorpayGateway } from './razorpay-gateway';

function fakePrisma(rows: any[]) {
  return {
    assessmentRequest: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matched = rows.filter((r) => matches(r, where));
        for (const r of matched) Object.assign(r, data);
        return { count: matched.length };
      }),
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

function fakeGateway(): jest.Mocked<RazorpayGateway> {
  return {
    createOrder: jest.fn(async (_params: Parameters<RazorpayGateway['createOrder']>[0]) => ({ id: 'unused' })),
    fetchOrder: jest.fn(async (_orderId: string) => ({ notes: null })),
    refundPayment: jest.fn(async (_paymentId: string, _amount: number) => ({ id: 'refund-1' })),
  };
}

function expiredRequest(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'req-1',
    orgId: 'org-1',
    requestedByUserId: 'user-employer-1',
    candidateId: 'candidate-1',
    skillId: 'skill-1',
    level: 'L2',
    status: AssessmentRequestStatus.PAID_PENDING_START,
    razorpayPaymentId: 'pay-1',
    razorpayRefundId: null,
    amount: 50000,
    expiresAt: new Date(Date.now() - 60_000),
    skill: { name: 'RAG Systems' },
    candidateProfile: { fullName: 'Jordan Lee' },
    ...overrides,
  };
}

function makeJob(rows: any[]) {
  const prisma = fakePrisma(rows);
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const gateway = fakeGateway();
  const job = new AssessmentRequestsRefundJob(prisma as any, notifications as any, gateway);
  return { job, prisma, notifications, gateway };
}

describe('AssessmentRequestsRefundJob', () => {
  it('happy path: refunds an expired PAID_PENDING_START row and transitions to EXPIRED_REFUNDED', async () => {
    const rows = [expiredRequest()];
    const { job, gateway, notifications } = makeJob(rows);

    await job.run();

    expect(gateway.refundPayment).toHaveBeenCalledWith('pay-1', 50000);
    expect(rows[0].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);
    expect(rows[0].razorpayRefundId).toBe('refund-1');
    expect(notifications.sendEmail).toHaveBeenCalledWith(
      'user-employer-1',
      'ASSESSMENT_REQUEST_EXPIRED',
      expect.any(String),
      expect.any(String),
    );
  });

  it('ignores PAID_PENDING_START rows that have not expired yet', async () => {
    const rows = [expiredRequest({ expiresAt: new Date(Date.now() + 60_000) })];
    const { job, gateway } = makeJob(rows);

    await job.run();

    expect(gateway.refundPayment).not.toHaveBeenCalled();
    expect(rows[0].status).toBe(AssessmentRequestStatus.PAID_PENDING_START);
  });

  it('never refunds a STARTED request, even if it would otherwise match on age', async () => {
    const rows = [expiredRequest({ status: AssessmentRequestStatus.STARTED })];
    const { job, gateway } = makeJob(rows);

    await job.run();

    expect(gateway.refundPayment).not.toHaveBeenCalled();
    expect(rows[0].status).toBe(AssessmentRequestStatus.STARTED);
  });

  describe('refund failure -> retry', () => {
    it('a failed refund call leaves the row at REFUND_FAILED, not silently dropped', async () => {
      const rows = [expiredRequest()];
      const { job, gateway } = makeJob(rows);
      gateway.refundPayment.mockRejectedValueOnce(new Error('Razorpay outage'));

      await job.run();

      expect(rows[0].status).toBe(AssessmentRequestStatus.REFUND_FAILED);
      expect(rows[0].razorpayRefundId).toBeNull();
    });

    it('a REFUND_FAILED row is retried and succeeds on the next run', async () => {
      const rows = [expiredRequest({ status: AssessmentRequestStatus.REFUND_FAILED })];
      const { job, gateway } = makeJob(rows);

      await job.run();

      expect(gateway.refundPayment).toHaveBeenCalledTimes(1);
      expect(rows[0].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);
      expect(rows[0].razorpayRefundId).toBe('refund-1');
    });

    it('a row stuck failing keeps retrying every run until it succeeds', async () => {
      const rows = [expiredRequest()];
      const { job, gateway } = makeJob(rows);
      gateway.refundPayment.mockRejectedValueOnce(new Error('outage 1'));
      await job.run();
      expect(rows[0].status).toBe(AssessmentRequestStatus.REFUND_FAILED);

      gateway.refundPayment.mockRejectedValueOnce(new Error('outage 2'));
      await job.run();
      expect(rows[0].status).toBe(AssessmentRequestStatus.REFUND_FAILED);

      // Third run: gateway finally succeeds (default mock behavior).
      await job.run();
      expect(rows[0].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);
      expect(gateway.refundPayment).toHaveBeenCalledTimes(3);
    });
  });

  describe('double-refund guard', () => {
    it('never calls Razorpay again for a row that already has a razorpayRefundId', async () => {
      const rows = [
        expiredRequest({
          status: AssessmentRequestStatus.REFUND_FAILED, // status inconsistent with a refund having succeeded, on purpose
          razorpayRefundId: 'refund-already-done',
        }),
      ];
      const { job, gateway } = makeJob(rows);

      await job.run();

      expect(gateway.refundPayment).not.toHaveBeenCalled();
      // Self-heals the status to agree with the refund having already happened.
      expect(rows[0].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);
    });

    it('a row already EXPIRED_REFUNDED is not touched at all — it does not match the sweep query', async () => {
      const rows = [expiredRequest({ status: AssessmentRequestStatus.EXPIRED_REFUNDED, razorpayRefundId: 'refund-1' })];
      const { job, gateway } = makeJob(rows);

      await job.run();

      expect(gateway.refundPayment).not.toHaveBeenCalled();
    });
  });

  describe('start-vs-expiry race', () => {
    it('if the candidate starts between the sweep query and the claim, the claim loses and no refund happens', async () => {
      const rows = [expiredRequest()];
      const { job, prisma, gateway } = makeJob(rows);

      // Simulate the candidate's own atomic start winning the race right
      // after sweep()'s findMany but before refundOne()'s claim attempt —
      // by the time refundOne runs its own conditional updateMany, status
      // is already STARTED, so that updateMany (WHERE status =
      // PAID_PENDING_START) must match zero rows.
      const originalUpdateMany = prisma.assessmentRequest.updateMany;
      let firstCall = true;
      prisma.assessmentRequest.updateMany = jest.fn(async (args: any) => {
        if (firstCall && args.data.status === AssessmentRequestStatus.REFUND_FAILED) {
          firstCall = false;
          rows[0].status = AssessmentRequestStatus.STARTED; // the "concurrent" start
        }
        return originalUpdateMany(args);
      });

      await job.run();

      expect(gateway.refundPayment).not.toHaveBeenCalled();
      expect(rows[0].status).toBe(AssessmentRequestStatus.STARTED);
    });
  });

  it('one row throwing unexpectedly does not stop the rest of the sweep', async () => {
    const rows = [expiredRequest({ id: 'req-1' }), expiredRequest({ id: 'req-2', razorpayPaymentId: 'pay-2' })];
    const { job, prisma, gateway } = makeJob(rows);
    jest.spyOn(prisma.assessmentRequest, 'findUnique').mockImplementationOnce(async () => {
      throw new Error('unexpected DB blip');
    });

    await job.run();

    expect(rows[1].status).toBe(AssessmentRequestStatus.EXPIRED_REFUNDED);
    expect(gateway.refundPayment).toHaveBeenCalledTimes(1);
  });
});
