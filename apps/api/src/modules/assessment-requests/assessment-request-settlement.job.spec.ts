import { AssessmentRequestStatus } from '@prisma/client';
import { AssessmentRequestSettlementJob } from './assessment-request-settlement.job';

function fakePrisma(rows: any[]) {
  return {
    assessmentRequest: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
    },
  };

  function matches(row: any, where: any): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      // Relation filter, e.g. { job: { status: 'CLOSED' } } — rows carry their job inline here.
      if (key === 'job' && cond && typeof cond === 'object') {
        if (!row.job || !matches(row.job, cond)) return false;
        continue;
      }
      if (cond === null) {
        if (row[key] !== null) return false;
      } else if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('lte' in (cond as any) && !(row[key] <= (cond as any).lte)) return false;
      } else if (row[key] !== cond) {
        return false;
      }
    }
    return true;
  }
}

function dueRequest(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'req-1',
    orgId: 'org-1',
    level: null,
    status: AssessmentRequestStatus.STARTED,
    startedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago — past the 14-day backstop
    ...overrides,
  };
}

function makeJob(rows: any[]) {
  const prisma = fakePrisma(rows);
  const requests = {
    maybeSettleWholeSkill: jest.fn(async () => undefined),
    withdrawForClosedJob: jest.fn(async () => undefined),
  };
  const job = new AssessmentRequestSettlementJob(prisma as any, requests as any);
  return { job, prisma, requests };
}

describe('AssessmentRequestSettlementJob', () => {
  it('settles a whole-skill STARTED request past its 14-day deadline', async () => {
    const rows = [dueRequest()];
    const { job, requests } = makeJob(rows);

    await job.run();

    expect(requests.maybeSettleWholeSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 'req-1' }));
  });

  it('ignores a whole-skill STARTED request that has not reached the 14-day deadline yet', async () => {
    const rows = [dueRequest({ startedAt: new Date(Date.now() - 60_000) })];
    const { job, requests } = makeJob(rows);

    await job.run();

    expect(requests.maybeSettleWholeSkill).not.toHaveBeenCalled();
  });

  it('never selects a legacy (level != null) request — it has no settlement concept', async () => {
    const rows = [dueRequest({ level: 'L2' })];
    const { job, requests } = makeJob(rows);

    await job.run();

    expect(requests.maybeSettleWholeSkill).not.toHaveBeenCalled();
  });

  it('never selects an ACCRUED_PENDING_START or already-COMPLETED request', async () => {
    const rows = [dueRequest({ status: AssessmentRequestStatus.ACCRUED_PENDING_START }), dueRequest({ id: 'req-2', status: AssessmentRequestStatus.COMPLETED })];
    const { job, requests } = makeJob(rows);

    await job.run();

    expect(requests.maybeSettleWholeSkill).not.toHaveBeenCalled();
  });

  it('one row throwing unexpectedly does not stop the rest of the sweep', async () => {
    const rows = [dueRequest({ id: 'req-1' }), dueRequest({ id: 'req-2' })];
    const prisma = fakePrisma(rows);
    const requests = {
      maybeSettleWholeSkill: jest.fn().mockRejectedValueOnce(new Error('unexpected DB blip')).mockResolvedValueOnce(undefined),
      withdrawForClosedJob: jest.fn(async () => undefined),
    };
    const job = new AssessmentRequestSettlementJob(prisma as any, requests as any);

    await job.run();

    expect(requests.maybeSettleWholeSkill).toHaveBeenCalledTimes(2);
  });

  it('survives sweep() itself throwing (e.g. the findMany query failing)', async () => {
    const { job, prisma } = makeJob([]);
    prisma.assessmentRequest.findMany.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(job.run()).resolves.toBeUndefined();
  });

  describe('job-linked withdrawals (2026-10-21)', () => {
    it('withdraws a not-yet-started request whose job has closed', async () => {
      const rows = [dueRequest({ id: 'req-closed', status: AssessmentRequestStatus.ACCRUED_PENDING_START, job: { status: 'CLOSED' } })];
      const { job, requests } = makeJob(rows);

      await job.run();

      expect(requests.withdrawForClosedJob).toHaveBeenCalledWith('req-closed');
      expect(requests.maybeSettleWholeSkill).not.toHaveBeenCalled();
    });

    it('leaves alone a not-yet-started request whose job is still open, or that has no job', async () => {
      const rows = [
        dueRequest({ id: 'req-open', status: AssessmentRequestStatus.ACCRUED_PENDING_START, job: { status: 'LIVE' } }),
        dueRequest({ id: 'req-nojob', status: AssessmentRequestStatus.ACCRUED_PENDING_START, job: null }),
      ];
      const { job, requests } = makeJob(rows);

      await job.run();

      expect(requests.withdrawForClosedJob).not.toHaveBeenCalled();
    });

    it('never withdraws a started request, even if its job closed', async () => {
      const rows = [dueRequest({ id: 'req-started', startedAt: new Date(), job: { status: 'CLOSED' } })];
      const { job, requests } = makeJob(rows);

      await job.run();

      expect(requests.withdrawForClosedJob).not.toHaveBeenCalled();
    });

    it('one withdrawal failing does not stop the rest', async () => {
      const rows = [
        dueRequest({ id: 'a', status: AssessmentRequestStatus.ACCRUED_PENDING_START, job: { status: 'CLOSED' } }),
        dueRequest({ id: 'b', status: AssessmentRequestStatus.ACCRUED_PENDING_START, job: { status: 'CLOSED' } }),
      ];
      const { job, requests } = makeJob(rows);
      requests.withdrawForClosedJob.mockRejectedValueOnce(new Error('blip'));

      await job.run();

      expect(requests.withdrawForClosedJob).toHaveBeenCalledTimes(2);
    });
  });
});
