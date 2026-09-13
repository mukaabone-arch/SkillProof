import { AssessmentRequestStatus, AssessmentSessionStatus, AttemptStatus, SkillLevel } from '@prisma/client';
import { AssessmentRequestsService } from './assessment-requests.service';

const { L1, L2, L3 } = SkillLevel;
const ASSESSMENT_BY_LEVEL: Record<string, string> = { L1: 'assessment-l1', L2: 'assessment-l2', L3: 'assessment-l3' };

/** Minimal in-memory AssessmentRequest(+Level) tables — just enough surface to exercise the service's own logic without a real DB. Skill-1 offers all three levels as live TEST assessments. */
function fakePrisma() {
  const requests: any[] = [];
  const levels: any[] = [];
  const attempts: any[] = [
    { id: 'attempt-l1', assessmentId: 'assessment-l1', status: AttemptStatus.IN_PROGRESS, badge: null },
    { id: 'attempt-l2', assessmentId: 'assessment-l2', status: AttemptStatus.IN_PROGRESS, badge: null },
    { id: 'attempt-l3', assessmentId: 'assessment-l3', status: AttemptStatus.IN_PROGRESS, badge: null },
  ];
  const sessions: any[] = [{ id: 'session-1', status: AssessmentSessionStatus.IN_PROGRESS, badge: null }];
  let nextId = 1;

  return {
    _requests: requests,
    _levels: levels,
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
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.skillId !== 'skill-1' || !where.isLive) return null;
        const id = ASSESSMENT_BY_LEVEL[where.targetLevel];
        return id ? { id, skillId: 'skill-1', targetLevel: where.targetLevel } : null;
      }),
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, durationMins: 30 })),
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
        const { levels: levelsInput, ...rest } = data;
        const row = { id: `req-${nextId++}`, createdAt: new Date(), updatedAt: new Date(), level: null, ...rest };
        requests.push(row);
        if (levelsInput?.create) {
          for (const lvl of levelsInput.create) {
            levels.push({
              id: `lvl-${nextId++}`,
              assessmentRequestId: row.id,
              createdAt: new Date(),
              updatedAt: new Date(),
              attemptId: null,
              sessionId: null,
              badgeId: null,
              ...lvl,
            });
          }
        }
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
    assessmentRequestLevel: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.assessmentRequestId_level) {
          const { assessmentRequestId, level } = where.assessmentRequestId_level;
          return levels.find((l) => l.assessmentRequestId === assessmentRequestId && l.level === level) ?? null;
        }
        return levels.find((l) => l.id === where.id) ?? null;
      }),
      findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
        const matched = levels.filter((l) => matches(l, where));
        if (orderBy?.level) matched.sort((a, b) => (orderBy.level === 'asc' ? a.level.localeCompare(b.level) : b.level.localeCompare(a.level)));
        return matched;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = levels.find((l) => l.id === where.id);
        Object.assign(row, data);
        return row;
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
        if ('lte' in (cond as any) && !(row[key] <= (cond as any).lte)) return false;
      } else if (row[key] !== cond) {
        return false;
      }
    }
    return true;
  }

  /** Resolves just the relations the service actually `include`s — fixed fake data, not a real join. */
  function withIncludes(row: any, include: any): any {
    if (!include) return row;
    const resolved = { ...row };
    if (include.organization) resolved.organization = { id: 'org-1', name: 'Acme Inc' };
    if (include.skill) resolved.skill = { id: 'skill-1', name: 'RAG Systems' };
    if (include.candidateProfile) resolved.candidateProfile = { id: 'candidate-1', userId: 'user-candidate-1', fullName: 'Jordan Lee' };
    if (include.requestedByUser) resolved.requestedByUser = { id: 'user-employer-1' };
    if (include.levels) resolved.levels = levels.filter((l) => l.assessmentRequestId === row.id);
    if (include.badge) {
      resolved.badge = row.badgeId
        ? { id: row.badgeId, verifyHash: `hash-${row.badgeId}`, level: 'L2', expiresAt: new Date('2027-01-01') }
        : null;
    }
    return resolved;
  }
}

function makeService(overrides?: { badges?: Partial<Record<SkillLevel, { id: string }>> }) {
  const prisma = fakePrisma();
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const assessments = {
    startAttempt: jest.fn(async (_userId: string, assessmentId: string) => prisma._attempts.find((a) => a.assessmentId === assessmentId)),
    getScoreAndTopicBreakdown: jest.fn(async (_attemptId: string) => ({
      scorePercent: 80,
      topicBreakdown: { topics: [{ topic: 'Chunking', correct: 4, asked: 5 }], excludedCount: 0 },
    })),
  };
  const assessmentSessions = { createSession: jest.fn(async () => ({ session: prisma._sessions[0], turns: [], claimFeedback: [] })) };
  const badgeResolver = { resolveLevelMap: jest.fn(async () => overrides?.badges ?? {}) };
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

describe('AssessmentRequestsService — whole-skill (2026-09-14 outcome-priced rework)', () => {
  describe('create', () => {
    it('rejects a candidate not on the org shortlist (IDOR guard)', async () => {
      const { service } = makeService();
      await expect(service.create('org-1', 'user-employer-1', 'candidate-not-shortlisted', 'skill-1')).rejects.toThrow(
        'This candidate is not on your shortlist.',
      );
    });

    it('creates a whole-skill request with three level children and accrues NOTHING — no Transaction, no amount', async () => {
      const { service, prisma, transactions } = makeService();

      const result = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');

      expect(result.alreadyBadged).toBe(false);
      expect(transactions.recordSystemTransaction).not.toHaveBeenCalled();
      const row = prisma._requests.find((r: any) => r.id === result.requestId);
      expect(row.status).toBe(AssessmentRequestStatus.ACCRUED_PENDING_START);
      expect(row.level).toBeNull();
      expect(row.amount).toBeUndefined();
      expect(row.transactionId).toBeUndefined();
      const children = prisma._levels.filter((l: any) => l.assessmentRequestId === row.id);
      expect(children.map((c: any) => c.level).sort()).toEqual([L1, L2, L3]);
      expect(children.every((c: any) => c.badgeId === null)).toBe(true);
    });

    it('sets expiresAt 5 days out (unchanged window) and notifies the candidate', async () => {
      const { service, prisma, notifications } = makeService();
      const before = Date.now();

      const result = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');

      const row = prisma._requests.find((r: any) => r.id === result.requestId);
      const expectedExpiry = before + 5 * 24 * 60 * 60 * 1000;
      expect(Math.abs(row.expiresAt.getTime() - expectedExpiry)).toBeLessThan(5000);
      expect(notifications.sendEmail).toHaveBeenCalledWith('user-candidate-1', 'ASSESSMENT_REQUEST_INVITE', expect.any(String), expect.any(String));
    });

    it('all three levels already badged: short-circuits to ALREADY_BADGED, zero charge, each child pre-filled with its badgeId', async () => {
      const badges = { [L1]: { id: 'badge-l1' }, [L2]: { id: 'badge-l2' }, [L3]: { id: 'badge-l3' } };
      const { service, prisma, transactions } = makeService({ badges });

      const result = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');

      expect(result.alreadyBadged).toBe(true);
      expect(transactions.recordSystemTransaction).not.toHaveBeenCalled();
      const row = prisma._requests.find((r: any) => r.id === result.requestId);
      expect(row.status).toBe(AssessmentRequestStatus.ALREADY_BADGED);
      const children = prisma._levels.filter((l: any) => l.assessmentRequestId === row.id);
      expect(children.find((c: any) => c.level === L1).badgeId).toBe('badge-l1');
      expect(children.find((c: any) => c.level === L3).badgeId).toBe('badge-l3');
    });

    it('only SOME levels already badged: stays ACCRUED_PENDING_START (not ALREADY_BADGED) — free levels pre-filled, the rest open', async () => {
      const badges = { [L1]: { id: 'badge-l1' } };
      const { service, prisma } = makeService({ badges });

      const result = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');

      expect(result.alreadyBadged).toBe(false);
      const row = prisma._requests.find((r: any) => r.id === result.requestId);
      expect(row.status).toBe(AssessmentRequestStatus.ACCRUED_PENDING_START);
      const children = prisma._levels.filter((l: any) => l.assessmentRequestId === row.id);
      expect(children.find((c: any) => c.level === L1).badgeId).toBe('badge-l1');
      expect(children.find((c: any) => c.level === L2).badgeId).toBeNull();
    });

    it('rejects a skill with no requestable levels at all', async () => {
      const { service, prisma } = makeService();
      // No live TEST assessments anywhere, and not the one fixed DISCUSSION
      // skill+level either (skill.findUnique returning null closes that
      // fallback too — see resolveFormat).
      prisma.assessment.findFirst.mockResolvedValue(null);
      prisma.skill.findUnique.mockResolvedValue(null);
      await expect(service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1')).rejects.toThrow(
        'This skill has no assessment levels available to request.',
      );
    });
  });

  describe('startFromRequest', () => {
    it('starting any one level first: claims STARTED + startedAt on the parent, launches that level only', async () => {
      const { service, prisma, assessments } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');

      const result = await service.startFromRequest(created.requestId, L2, 'user-candidate-1');

      expect(result.attemptId).toBe('attempt-l2');
      expect(assessments.startAttempt).toHaveBeenCalledWith('user-candidate-1', 'assessment-l2', { skipLevelAndRetakeChecks: true });
      const row = prisma._requests.find((r: any) => r.id === created.requestId);
      expect(row.status).toBe(AssessmentRequestStatus.STARTED);
      expect(row.startedAt).toBeInstanceOf(Date);
      const l1Child = prisma._levels.find((l: any) => l.assessmentRequestId === created.requestId && l.level === L1);
      expect(l1Child.attemptId).toBeNull(); // untouched — only L2 was started
    });

    it('starting a second, different level after the first: does not re-claim the parent, still launches that level', async () => {
      const { service, prisma, assessments } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await service.startFromRequest(created.requestId, L1, 'user-candidate-1');
      const firstStartedAt = prisma._requests.find((r: any) => r.id === created.requestId).startedAt;

      const result = await service.startFromRequest(created.requestId, L3, 'user-candidate-1');

      expect(result.attemptId).toBe('attempt-l3');
      expect(assessments.startAttempt).toHaveBeenCalledTimes(2);
      const row = prisma._requests.find((r: any) => r.id === created.requestId);
      expect(row.startedAt).toEqual(firstStartedAt); // unchanged — only the FIRST start sets this
    });

    it('re-starting the same level is idempotent — no second attempt created', async () => {
      const { service, assessments } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');

      await service.startFromRequest(created.requestId, L2, 'user-candidate-1');
      const second = await service.startFromRequest(created.requestId, L2, 'user-candidate-1');

      expect(second.attemptId).toBe('attempt-l2');
      expect(assessments.startAttempt).toHaveBeenCalledTimes(1);
    });

    it('refuses to start a level the candidate already holds a verified badge for', async () => {
      const badges = { [L1]: { id: 'badge-l1' } };
      const { service } = makeService({ badges });
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');

      await expect(service.startFromRequest(created.requestId, L1, 'user-candidate-1')).rejects.toThrow(
        'You already hold a verified badge at this level.',
      );
    });

    it('blocks starting after the 5-day expiry window', async () => {
      const { service, prisma } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await prisma.assessmentRequest.update({ where: { id: created.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });

      await expect(service.startFromRequest(created.requestId, L1, 'user-candidate-1')).rejects.toThrow('This invitation has expired.');
    });

    it('the start-vs-expiry race: once the expiry sweep has claimed a row, starting it is blocked, never both', async () => {
      const { service, prisma, assessments } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await prisma.assessmentRequest.updateMany({
        where: { id: created.requestId, status: AssessmentRequestStatus.ACCRUED_PENDING_START },
        data: { status: AssessmentRequestStatus.EXPIRED_UNBILLED },
      });

      await expect(service.startFromRequest(created.requestId, L1, 'user-candidate-1')).rejects.toThrow('This invitation has expired.');
      expect(assessments.startAttempt).not.toHaveBeenCalled();
    });

    it('rejects a candidate who does not own the request', async () => {
      const { service } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await expect(service.startFromRequest(created.requestId, L1, 'some-other-user')).rejects.toThrow();
    });

    it('refuses to start any level once the request has already settled', async () => {
      const { service, prisma } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await prisma.assessmentRequest.update({ where: { id: created.requestId }, data: { status: AssessmentRequestStatus.COMPLETED } });

      await expect(service.startFromRequest(created.requestId, L2, 'user-candidate-1')).rejects.toThrow('This request has already been settled.');
    });
  });

  describe('settlement', () => {
    async function startAllThree(service: AssessmentRequestsService, requestId: string) {
      await service.startFromRequest(requestId, L1, 'user-candidate-1');
      await service.startFromRequest(requestId, L2, 'user-candidate-1');
      await service.startFromRequest(requestId, L3, 'user-candidate-1');
    }

    it('settles COMPLETE (₹500 base -> ₹590 total) the moment all three levels are attempted — regardless of pass/fail', async () => {
      const { service, prisma, transactions, notifications } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await startAllThree(service, created.requestId);
      prisma._attempts[0].status = AttemptStatus.GRADED; // L1: pass
      prisma._attempts[0].badge = { id: 'badge-l1' };
      prisma._attempts[1].status = AttemptStatus.GRADED; // L2: fail — still "attempted"
      prisma._attempts[1].badge = null;
      prisma._attempts[2].status = AttemptStatus.GRADED; // L3: pass
      prisma._attempts[2].badge = { id: 'badge-l3' };

      const result = await service.getForEmployer('org-1', created.requestId);

      expect(result.status).toBe(AssessmentRequestStatus.COMPLETED);
      expect(transactions.recordSystemTransaction).toHaveBeenCalledWith(
        'billing-profile-1',
        expect.objectContaining({ amountPaise: 59000, type: 'ASSESSMENT_REQUEST_ACCRUAL', status: 'PENDING' }),
      );
      const row = prisma._requests.find((r: any) => r.id === created.requestId);
      expect(row.amount).toBe(59000);
      expect(row.transactionId).toBe('txn-1');
      expect(notifications.sendEmail).toHaveBeenCalledWith('user-employer-1', 'ASSESSMENT_REQUEST_RESULT', expect.any(String), expect.any(String));
    });

    it('a pre-existing badge on one level counts as "attempted" toward COMPLETE without a fresh attempt', async () => {
      const badges = { [L3]: { id: 'badge-l3-preexisting' } };
      const { service, prisma, transactions } = makeService({ badges });
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await service.startFromRequest(created.requestId, L1, 'user-candidate-1');
      await service.startFromRequest(created.requestId, L2, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED;
      prisma._attempts[0].badge = { id: 'badge-l1' };
      prisma._attempts[1].status = AttemptStatus.GRADED;
      prisma._attempts[1].badge = { id: 'badge-l2' };
      // L3 never started — it was already badged at creation time.

      const result = await service.getForEmployer('org-1', created.requestId);

      expect(result.status).toBe(AssessmentRequestStatus.COMPLETED);
      expect(transactions.recordSystemTransaction).toHaveBeenCalledWith('billing-profile-1', expect.objectContaining({ amountPaise: 59000 }));
    });

    it('does not settle while some levels are still outstanding and the 14-day deadline has not passed', async () => {
      const { service, prisma, transactions } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await service.startFromRequest(created.requestId, L1, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED;
      prisma._attempts[0].badge = { id: 'badge-l1' };
      // L2/L3 never started.

      const result = await service.getForEmployer('org-1', created.requestId);

      expect(result.status).toBe(AssessmentRequestStatus.STARTED);
      expect(transactions.recordSystemTransaction).not.toHaveBeenCalled();
    });

    it('settles PARTIAL (₹150 base -> ₹177 total) once the 14-day deadline has passed with levels still outstanding', async () => {
      const { service, prisma, transactions } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await service.startFromRequest(created.requestId, L1, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED;
      prisma._attempts[0].badge = { id: 'badge-l1' };
      const row = prisma._requests.find((r: any) => r.id === created.requestId);
      row.startedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // 15 days ago — past the 14-day backstop

      const result = await service.maybeSettleWholeSkill(row);

      expect(result.status).toBe(AssessmentRequestStatus.COMPLETED);
      expect(transactions.recordSystemTransaction).toHaveBeenCalledWith('billing-profile-1', expect.objectContaining({ amountPaise: 17700 }));
    });

    it('past the deadline, still settles COMPLETE (not PARTIAL) if all three happen to be attempted by then — the deadline is a backstop, not a discount', async () => {
      const { service, prisma, transactions } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await startAllThree(service, created.requestId);
      prisma._attempts.forEach((a: any) => {
        a.status = AttemptStatus.GRADED;
        a.badge = { id: `badge-${a.id}` };
      });
      const row = prisma._requests.find((r: any) => r.id === created.requestId);
      row.startedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

      const result = await service.maybeSettleWholeSkill(row);

      expect(transactions.recordSystemTransaction).toHaveBeenCalledWith('billing-profile-1', expect.objectContaining({ amountPaise: 59000 }));
      void result;
    });

    it('settlement is idempotent under a race — settling twice only ever writes one Transaction', async () => {
      const { service, prisma, transactions } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await startAllThree(service, created.requestId);
      prisma._attempts.forEach((a: any) => {
        a.status = AttemptStatus.GRADED;
        a.badge = { id: `badge-${a.id}` };
      });
      const row = prisma._requests.find((r: any) => r.id === created.requestId);

      await Promise.all([service.maybeSettleWholeSkill(row), service.maybeSettleWholeSkill(row)]);

      expect(transactions.recordSystemTransaction).toHaveBeenCalledTimes(1);
    });

    it('never starting at all still costs nothing — EXPIRED_UNBILLED path is untouched by any of this', async () => {
      const { service, prisma, transactions } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await prisma.assessmentRequest.updateMany({
        where: { id: created.requestId, status: AssessmentRequestStatus.ACCRUED_PENDING_START },
        data: { status: AssessmentRequestStatus.EXPIRED_UNBILLED },
      });

      const result = await service.getForEmployer('org-1', created.requestId);

      expect(result.status).toBe(AssessmentRequestStatus.EXPIRED_UNBILLED);
      expect(transactions.recordSystemTransaction).not.toHaveBeenCalled();
    });
  });

  describe('withEmployerOutcome / withCandidateProgress — per-level breakdown', () => {
    it('the employer sees pass/fail per level, independently', async () => {
      const { service, prisma } = makeService();
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await service.startFromRequest(created.requestId, L1, 'user-candidate-1');
      await service.startFromRequest(created.requestId, L2, 'user-candidate-1');
      prisma._attempts[0].status = AttemptStatus.GRADED; // L1 passed
      prisma._attempts[0].badge = { id: 'badge-l1' };
      prisma._attempts[1].status = AttemptStatus.GRADED; // L2 failed
      prisma._attempts[1].badge = null;
      // L3 never started.

      const result = await service.getForEmployer('org-1', created.requestId);

      expect(result.levels).toEqual([
        expect.objectContaining({ level: L1, attempted: true, passed: true, scorePercent: 80 }),
        expect.objectContaining({ level: L2, attempted: true, passed: false, scorePercent: 80 }),
        expect.objectContaining({ level: L3, attempted: false, passed: null, scorePercent: null }),
      ]);
    });

    it('the candidate sees per-level progress including which are already badged for free', async () => {
      const badges = { [L3]: { id: 'badge-l3' } };
      const { service, prisma } = makeService({ badges });
      const created = await service.create('org-1', 'user-employer-1', 'candidate-1', 'skill-1');
      await service.startFromRequest(created.requestId, L1, 'user-candidate-1');

      const [result] = await service.listForCandidate('user-candidate-1');

      expect(result.levels).toEqual([
        expect.objectContaining({ level: L1, attemptId: 'attempt-l1', alreadyBadged: false }),
        expect.objectContaining({ level: L2, attemptId: null, alreadyBadged: false }),
        expect.objectContaining({ level: L3, alreadyBadged: true }),
      ]);
    });
  });
});

describe('AssessmentRequestsService — legacy single-level requests (pre-rework rows, frozen behavior)', () => {
  /** No new code ever creates one of these — inserted directly, the way an existing production row already looks. */
  async function legacyRow(prisma: ReturnType<typeof fakePrisma>, overrides: Partial<Record<string, unknown>> = {}) {
    return prisma.assessmentRequest.create({
      data: {
        orgId: 'org-1',
        requestedByUserId: 'user-employer-1',
        candidateId: 'candidate-1',
        skillId: 'skill-1',
        level: L2,
        status: AssessmentRequestStatus.ACCRUED_PENDING_START,
        amount: 17700,
        transactionId: 'txn-legacy-1',
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        attemptId: null,
        sessionId: null,
        badgeId: null,
        ...overrides,
      },
    });
  }

  it('starts via the legacy single-attempt path when the passed level matches the row', async () => {
    const { service, prisma, assessments } = makeService();
    const row = await legacyRow(prisma);

    const result = await service.startFromRequest(row.id, L2, 'user-candidate-1');

    expect(result.attemptId).toBe('attempt-l2');
    expect(assessments.startAttempt).toHaveBeenCalledWith('user-candidate-1', 'assessment-l2', { skipLevelAndRetakeChecks: true });
    const updated = prisma._requests.find((r: any) => r.id === row.id);
    expect(updated.status).toBe(AssessmentRequestStatus.STARTED);
    expect(updated.attemptId).toBe('attempt-l2');
  });

  it('rejects a start call naming a different level than the row itself', async () => {
    const { service, prisma } = makeService();
    const row = await legacyRow(prisma);
    await expect(service.startFromRequest(row.id, L1, 'user-candidate-1')).rejects.toThrow('This request is for a different level.');
  });

  it('a second start call is idempotent — does not create a second attempt', async () => {
    const { service, prisma, assessments } = makeService();
    const row = await legacyRow(prisma);

    await service.startFromRequest(row.id, L2, 'user-candidate-1');
    const second = await service.startFromRequest(row.id, L2, 'user-candidate-1');

    expect(second.attemptId).toBe('attempt-l2');
    expect(assessments.startAttempt).toHaveBeenCalledTimes(1);
  });

  it('blocks starting after expiry, same as before', async () => {
    const { service, prisma } = makeService();
    const row = await legacyRow(prisma, { expiresAt: new Date(Date.now() - 1000) });
    await expect(service.startFromRequest(row.id, L2, 'user-candidate-1')).rejects.toThrow('This invitation has expired.');
  });

  it('reconciles STARTED -> COMPLETED via the single linked attempt, unaffected by the whole-skill settlement path', async () => {
    const { service, prisma, notifications, transactions } = makeService();
    const row = await legacyRow(prisma);
    await service.startFromRequest(row.id, L2, 'user-candidate-1');
    prisma._attempts[1].status = AttemptStatus.GRADED;
    prisma._attempts[1].badge = { id: 'badge-earned-1' };

    const result = await service.getForEmployer('org-1', row.id);

    expect(result.status).toBe(AssessmentRequestStatus.COMPLETED);
    expect(result.badgeId).toBe('badge-earned-1');
    expect(result.levels).toBeUndefined(); // flat legacy shape, no per-level array
    expect(notifications.sendEmail).toHaveBeenCalledWith('user-employer-1', 'ASSESSMENT_REQUEST_RESULT', expect.any(String), expect.any(String));
    expect(transactions.recordSystemTransaction).not.toHaveBeenCalled(); // legacy already accrued at creation — settle() never runs for it
  });

  it('withEmployerOutcome keeps the flat passed/scorePercent/topicBreakdown shape, not the whole-skill levels array', async () => {
    const { service, prisma } = makeService();
    const row = await legacyRow(prisma, {
      status: AssessmentRequestStatus.COMPLETED,
      attemptId: 'attempt-l2',
      badgeId: 'badge-earned-1',
    });
    prisma._attempts[1].status = AttemptStatus.GRADED;
    prisma._attempts[1].badge = { id: 'badge-earned-1' };

    const result = await service.getForEmployer('org-1', row.id);

    expect(result.passed).toBe(true);
    expect(result.scorePercent).toBe(80);
    expect(result.levels).toBeUndefined();
  });
});
