import { AssessmentRequestStatus, AssessmentSessionStatus, AttemptStatus, SkillLevel } from '@prisma/client';
import { AssessmentRequestsService } from './assessment-requests.service';

/** Minimal in-memory AssessmentRequest table — just enough surface (findUnique/findFirst/findMany/create/update/updateMany) to exercise the service's own logic without a real DB. */
function fakePrisma() {
  const requests: any[] = [];
  const attempts: any[] = [{ id: 'attempt-1', assessmentId: 'assessment-1', status: AttemptStatus.IN_PROGRESS, badge: null }];
  const sessions: any[] = [{ id: 'session-1', status: AssessmentSessionStatus.IN_PROGRESS, badge: null }];
  let nextId = 1;

  return {
    _requests: requests,
    _attempts: attempts,
    _sessions: sessions,
    shortlistEntry: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.orgId === 'org-1' && where.candidateId === 'candidate-1' ? { id: 'entry-1' } : null,
      ),
    },
    candidateProfile: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id === 'candidate-1') return { id: 'candidate-1', userId: 'user-candidate-1', fullName: 'Jordan Lee' };
        if (where.userId === 'user-candidate-1') return { id: 'candidate-1', userId: 'user-candidate-1', fullName: 'Jordan Lee' };
        return null;
      }),
    },
    skill: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === 'skill-1' ? { id: 'skill-1', name: 'RAG Systems' } : null)),
      findFirst: jest.fn(async () => null),
    },
    assessment: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.skillId === 'skill-1' && where.targetLevel === SkillLevel.L2 && where.isLive
          ? { id: 'assessment-1', skillId: 'skill-1', targetLevel: SkillLevel.L2 }
          : null,
      ),
    },
    attempt: {
      findUnique: jest.fn(async ({ where }: any) => attempts.find((a) => a.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const row = attempts.find((a) => a.id === where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
    },
    assessmentSession: {
      findUnique: jest.fn(async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null),
    },
    assessmentRequest: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `req-${nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        requests.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where, include }: any) => {
        const row = requests.find((r) => r.id === where.id);
        return row ? withIncludes(row, include) : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where, include }: any) => {
        const row = requests.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        return withIncludes(row, include);
      }),
      findFirst: jest.fn(async ({ where }: any) => requests.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => requests.filter((r) => matches(r, where))),
      update: jest.fn(async ({ where, data }: any) => {
        const row = requests.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matched = requests.filter((r) => matches(r, where));
        for (const r of matched) Object.assign(r, data);
        return { count: matched.length };
      }),
    },
    billingProfile: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, gstStateCode: null })),
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

  /** Resolves just the relations notifyCandidateInvited/notifyEmployerResultReady actually `include` — fixed fake data, not a real join. */
  function withIncludes(row: any, include: any): any {
    if (!include) return row;
    const resolved = { ...row };
    if (include.organization) resolved.organization = { id: 'org-1', name: 'Acme Inc' };
    if (include.skill) resolved.skill = { id: 'skill-1', name: 'RAG Systems' };
    if (include.candidateProfile) resolved.candidateProfile = { id: 'candidate-1', userId: 'user-candidate-1', fullName: 'Jordan Lee' };
    if (include.requestedByUser) resolved.requestedByUser = { id: 'user-employer-1' };
    if (include.badge) {
      resolved.badge = row.badgeId
        ? { id: row.badgeId, verifyHash: `hash-${row.badgeId}`, level: 'L2', expiresAt: new Date('2027-01-01') }
        : null;
    }
    return resolved;
  }
}

function makeService(overrides?: { badge?: any }) {
  const prisma = fakePrisma();
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const assessments = {
    startAttempt: jest.fn(async () => prisma._attempts[0]),
    // Real shape from AssessmentsService.getScoreAndTopicBreakdown — a
    // fixed fixture is fine here since these tests are exercising
    // AssessmentRequestsService's own wiring (does it call this, with the
    // right attemptId, only when it should), not the aggregation itself
    // (that's topic-breakdown.spec.ts / assessments.service.spec.ts's job).
    getScoreAndTopicBreakdown: jest.fn(async (attemptId: string) => ({
      scorePercent: 80,
      topicBreakdown: { topics: [{ topic: 'Chunking', correct: 4, asked: 5 }], excludedCount: 0 },
    })),
  };
  const assessmentSessions = { createSession: jest.fn(async () => ({ session: prisma._sessions[0], turns: [], claimFeedback: [] })) };
  const badgeResolver = { resolveLevelMap: jest.fn(async () => (overrides?.badge ? { [SkillLevel.L2]: overrides.badge } : {})) };
  const transactions = { recordSystemTransaction: jest.fn(async () => ({ id: 'txn-1' })) };
  const billingProfiles = { ensureMinimalBillingProfile: jest.fn(async () => 'billing-profile-1') };

  const service = new AssessmentRequestsService(
    prisma as any,
    notifications as any,
    assessments as any,
    assessmentSessions as any,
    badgeResolver as any,
    transactions as any,
    billingProfiles as any,
  );
  return { service, prisma, notifications, assessments, assessmentSessions, badgeResolver, transactions, billingProfiles };
}

describe('AssessmentRequestsService', () => {
  describe('create — already-badged short-circuit', () => {
    it('creates an ALREADY_BADGED row and never accrues anything', async () => {
      const badge = { id: 'badge-1' };
      const { service, prisma, transactions } = makeService({ badge });

      const result = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);

      expect(result).toMatchObject({ alreadyBadged: true, badge });
      expect(transactions.recordSystemTransaction).not.toHaveBeenCalled();
      expect(prisma._requests).toHaveLength(1);
      expect(prisma._requests[0]).toMatchObject({ status: AssessmentRequestStatus.ALREADY_BADGED });
      expect(prisma._requests[0].amount).toBeUndefined();
    });

    it('rejects a candidate not on the org shortlist (IDOR guard)', async () => {
      const { service } = makeService();
      await expect(
        service.create('org-1', 'user-employer-1', 'candidate-not-shortlisted', 'skill-1', SkillLevel.L2),
      ).rejects.toThrow('This candidate is not on your shortlist.');
    });
  });

  describe('create — not badged (postpaid: one call, no payment step)', () => {
    it('creates ACCRUED_PENDING_START immediately, with expiresAt 5 days out, and notifies the candidate — no order/verify round trip', async () => {
      const { service, prisma, notifications } = makeService();

      // Captured independently of the fake's own `createdAt: new Date()`
      // (a separate timestamp from whatever the service used internally
      // to compute expiresAt) — asserting against a tolerance window
      // avoids the test itself being flaky by comparing two independently
      // taken instants for exact equality.
      const before = Date.now();
      const result = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);

      expect(result).toMatchObject({ alreadyBadged: false, amount: 17700, currency: 'INR' });
      const row = prisma._requests.find((r: any) => r.id === result.requestId);
      expect(row.status).toBe(AssessmentRequestStatus.ACCRUED_PENDING_START);
      expect(row.candidateId).toBe('candidate-1');
      const expectedExpiry = before + 5 * 24 * 60 * 60 * 1000;
      expect(Math.abs(row.expiresAt.getTime() - expectedExpiry)).toBeLessThan(5000);
      expect(notifications.sendEmail).toHaveBeenCalledWith(
        'user-candidate-1',
        'ASSESSMENT_REQUEST_INVITE',
        expect.any(String),
        expect.any(String),
      );
    });

    it('accrues the GST-inclusive total (₹150 base + 18% = ₹177), not the base amount', async () => {
      const { service } = makeService();

      const result = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);

      expect(result.amount).toBe(17700);
    });

    describe('GST ledger', () => {
      it('records a PENDING system Transaction with the correct base/GST split and links it back onto the request — no provider/order/payment fields at all', async () => {
        const { service, prisma, transactions, billingProfiles } = makeService();

        const result = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);

        expect(billingProfiles.ensureMinimalBillingProfile).toHaveBeenCalledWith('org-1');
        expect(transactions.recordSystemTransaction).toHaveBeenCalledWith(
          'billing-profile-1',
          expect.objectContaining({
            amountPaise: 17700,
            type: 'ASSESSMENT_REQUEST_ACCRUAL',
            status: 'PENDING',
            // Default place of supply (Maharashtra) is intra-state, so the
            // 18% splits evenly into 9%+9% CGST/SGST, none IGST.
            gst: { basePaise: 15000, gstPaise: 2700, totalPaise: 17700, cgstPaise: 1350, sgstPaise: 1350, igstPaise: 0, placeOfSupplyStateCode: '27' },
          }),
        );
        const call = (transactions.recordSystemTransaction as jest.Mock).mock.calls[0][1];
        expect(call.provider).toBeUndefined();
        expect(call.providerOrderId).toBeUndefined();
        expect(call.providerPaymentId).toBeUndefined();
        const row = prisma._requests.find((r: any) => r.id === result.requestId);
        expect(row.transactionId).toBe('txn-1');
      });
    });
  });

  describe('startFromRequest', () => {
    async function accruedRequest(service: AssessmentRequestsService) {
      return service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);
    }

    it('happy path: transitions to STARTED and launches the MCQ attempt', async () => {
      const { service, assessments, prisma } = makeService();
      const created = await accruedRequest(service);

      const result = await service.startFromRequest(created.requestId!, 'user-candidate-1');

      expect(result.attemptId).toBe('attempt-1');
      expect(assessments.startAttempt).toHaveBeenCalledWith('user-candidate-1', 'assessment-1', { skipLevelAndRetakeChecks: true });
      const updated = await prisma.assessmentRequest.findUnique({ where: { id: created.requestId } });
      expect(updated.status).toBe(AssessmentRequestStatus.STARTED);
      expect(updated.attemptId).toBe('attempt-1');
    });

    it('a second start call is idempotent — does not create a second attempt', async () => {
      const { service, assessments } = makeService();
      const created = await accruedRequest(service);

      await service.startFromRequest(created.requestId!, 'user-candidate-1');
      const second = await service.startFromRequest(created.requestId!, 'user-candidate-1');

      expect(second.attemptId).toBe('attempt-1');
      expect(assessments.startAttempt).toHaveBeenCalledTimes(1);
    });

    it('blocks starting after expiry with a graceful error', async () => {
      const { service, prisma } = makeService();
      const created = await accruedRequest(service);
      // Simulate the window having already closed.
      await prisma.assessmentRequest.update({ where: { id: created.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });

      await expect(service.startFromRequest(created.requestId!, 'user-candidate-1')).rejects.toThrow('This invitation has expired.');
    });

    it('the start-vs-expiry race: once the expiry job has claimed a row, starting it is blocked, never both', async () => {
      const { service, prisma } = makeService();
      const created = await accruedRequest(service);
      // Simulate the expiry job's own atomic claim (ACCRUED_PENDING_START -> EXPIRED_UNBILLED) winning first.
      await prisma.assessmentRequest.updateMany({
        where: { id: created.requestId, status: AssessmentRequestStatus.ACCRUED_PENDING_START },
        data: { status: AssessmentRequestStatus.EXPIRED_UNBILLED },
      });

      await expect(service.startFromRequest(created.requestId!, 'user-candidate-1')).rejects.toThrow('This invitation has expired.');
      const { assessments } = makeService();
      expect(assessments.startAttempt).not.toHaveBeenCalled();
    });

    it('rejects a candidate who does not own the request', async () => {
      const { service } = makeService();
      const created = await accruedRequest(service);
      await expect(service.startFromRequest(created.requestId!, 'some-other-user')).rejects.toThrow();
    });
  });

  describe('reconcile (STARTED -> COMPLETED)', () => {
    it('promotes to COMPLETED once the linked attempt is GRADED, and notifies the employer', async () => {
      const { service, prisma, notifications } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);
      await service.startFromRequest(created.requestId!, 'user-candidate-1');

      // Simulate grading finishing, independently of AssessmentRequestsService (pull-based reconciliation).
      prisma._attempts[0].status = AttemptStatus.GRADED;
      prisma._attempts[0].badge = { id: 'badge-earned-1' };

      const result = await service.getForEmployer('org-1', created.requestId!);

      expect(result.status).toBe(AssessmentRequestStatus.COMPLETED);
      expect(result.badgeId).toBe('badge-earned-1');
      expect(notifications.sendEmail).toHaveBeenCalledWith(
        'user-employer-1',
        'ASSESSMENT_REQUEST_RESULT',
        expect.any(String),
        expect.any(String),
      );
    });

    it('does not re-notify on a second read once already COMPLETED', async () => {
      const { service, prisma, notifications } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);
      await service.startFromRequest(created.requestId!, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED;

      await service.getForEmployer('org-1', created.requestId!);
      notifications.sendEmail.mockClear();
      await service.getForEmployer('org-1', created.requestId!);

      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('employer outcome — badge, pass/fail, score, and topic breakdown (the requesting employer only)', () => {
    it('a completed TEST-format request carries passed, badge (hash/level/expiry), scorePercent, and topicBreakdown — reusing AssessmentsService.getScoreAndTopicBreakdown, not reimplementing it', async () => {
      const { service, prisma, assessments } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);
      await service.startFromRequest(created.requestId!, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED;
      prisma._attempts[0].badge = { id: 'badge-earned-1' };

      const result = await service.getForEmployer('org-1', created.requestId!);

      expect(result.passed).toBe(true);
      expect(result.badge).toEqual({ id: 'badge-earned-1', verifyHash: 'hash-badge-earned-1', level: 'L2', expiresAt: new Date('2027-01-01') });
      expect(assessments.getScoreAndTopicBreakdown).toHaveBeenCalledWith('attempt-1');
      expect(result.scorePercent).toBe(80);
      expect(result.topicBreakdown).toEqual({ topics: [{ topic: 'Chunking', correct: 4, asked: 5 }], excludedCount: 0 });
    });

    it('a completed request with no badge (failed) still gets passed:false and the score/breakdown — a fail is a paid-for result too', async () => {
      const { service, prisma } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);
      await service.startFromRequest(created.requestId!, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED;
      prisma._attempts[0].badge = null; // graded but didn't pass

      const result = await service.getForEmployer('org-1', created.requestId!);

      expect(result.passed).toBe(false);
      expect(result.badge).toBeNull();
      expect(result.scorePercent).toBe(80); // still surfaced — a fail is a result, not a non-result
    });

    it('a DISCUSSION-format completed request gets passed/badge but scorePercent/topicBreakdown are null — not zeroed, not an empty breakdown', async () => {
      const { service, prisma, assessments } = makeService();
      // Bypasses the full state machine deliberately — this test is about
      // withEmployerOutcome's own branching (attemptId vs sessionId), not
      // about re-exercising startFromRequest's DISCUSSION path (already
      // covered by this file's other describe blocks and by
      // AssessmentSessionsService's own tests).
      const row = await prisma.assessmentRequest.create({
        data: {
          orgId: 'org-1',
          requestedByUserId: 'user-employer-1',
          candidateId: 'candidate-1',
          skillId: 'skill-1',
          level: 'L2',
          status: AssessmentRequestStatus.COMPLETED,
          attemptId: null,
          sessionId: 'session-1',
          badgeId: 'badge-discussion-1',
        },
      });

      const result = await service.getForEmployer('org-1', row.id);

      expect(result.passed).toBe(true);
      expect(result.badge).toEqual({ id: 'badge-discussion-1', verifyHash: 'hash-badge-discussion-1', level: 'L2', expiresAt: new Date('2027-01-01') });
      expect(result.scorePercent).toBeNull();
      expect(result.topicBreakdown).toBeNull();
      expect(assessments.getScoreAndTopicBreakdown).not.toHaveBeenCalled();
    });

    it('a not-yet-completed request gets passed:null and no score/breakdown — nothing to report yet', async () => {
      const { service, assessments } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);
      // Still ACCRUED_PENDING_START — never started.

      const result = await service.getForEmployer('org-1', created.requestId!);

      expect(result.passed).toBeNull();
      expect(result.scorePercent).toBeNull();
      expect(result.topicBreakdown).toBeNull();
      expect(assessments.getScoreAndTopicBreakdown).not.toHaveBeenCalled();
    });

    it('listForEmployer enriches every completed request in the list, not just a single get', async () => {
      const { service, prisma } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);
      await service.startFromRequest(created.requestId!, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED;
      prisma._attempts[0].badge = { id: 'badge-earned-1' };

      const [result] = await service.listForEmployer('org-1');

      expect(result.passed).toBe(true);
      expect(result.scorePercent).toBe(80);
    });

    it('never reaches an employer outside the owning org — the ownership check runs before any enrichment', async () => {
      const { service, prisma } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1', SkillLevel.L2);
      await service.startFromRequest(created.requestId!, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED;
      prisma._attempts[0].badge = { id: 'badge-earned-1' };

      await expect(service.getForEmployer('some-other-org', created.requestId!)).rejects.toThrow('Assessment request not found');
    });
  });
});
