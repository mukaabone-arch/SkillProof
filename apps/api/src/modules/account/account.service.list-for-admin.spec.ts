import {
  AccountActionReason,
  AccountActionType,
  AssessmentRequestStatus,
  NotificationStatus,
  NotificationType,
  ShortlistStage,
} from '@prisma/client';
import { AccountService } from './account.service';

interface FakeAction {
  id: string;
  candidateProfileId: string;
  userId: string;
  type: AccountActionType;
  reasonCategory: AccountActionReason | null;
  reasonText: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  deactivatedAt: Date | null;
}
interface FakeNotification {
  userId: string;
  type: NotificationType;
  status: NotificationStatus;
  createdAt: Date;
}
interface FakeShortlistEntry {
  candidateId: string;
  stage: ShortlistStage;
}
interface FakeAssessmentRequest {
  candidateId: string;
  status: AssessmentRequestStatus;
}

/** Minimal in-memory stand-in — just enough of the four models listActionsForAdmin reads to exercise its correlation logic without a real DB. */
function fakePrisma(seed: {
  actions: FakeAction[];
  notifications?: FakeNotification[];
  entries?: FakeShortlistEntry[];
  requests?: FakeAssessmentRequest[];
}) {
  const notifications = seed.notifications ?? [];
  const entries = seed.entries ?? [];
  const requests = seed.requests ?? [];

  return {
    accountAction: {
      findMany: jest.fn(async () => {
        const sorted = [...seed.actions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return sorted.map((a) => ({
          id: a.id,
          candidateProfileId: a.candidateProfileId,
          type: a.type,
          reasonCategory: a.reasonCategory,
          reasonText: a.reasonText,
          createdAt: a.createdAt,
          candidateProfile: { id: a.candidateProfileId, userId: a.userId, deletedAt: a.deletedAt, deactivatedAt: a.deactivatedAt },
        }));
      }),
    },
    shortlistEntry: {
      groupBy: jest.fn(async ({ where }: { where: { candidateId: { in: string[] }; stage: ShortlistStage } }) => {
        const counts = new Map<string, number>();
        for (const e of entries) {
          if (!where.candidateId.in.includes(e.candidateId) || e.stage !== where.stage) continue;
          counts.set(e.candidateId, (counts.get(e.candidateId) ?? 0) + 1);
        }
        return [...counts.entries()].map(([candidateId, count]) => ({ candidateId, _count: { _all: count } }));
      }),
    },
    assessmentRequest: {
      findMany: jest.fn(async ({ where }: { where: { candidateId: { in: string[] }; status: AssessmentRequestStatus } }) => {
        const seen = new Set<string>();
        return requests
          .filter((r) => where.candidateId.in.includes(r.candidateId) && r.status === where.status)
          .filter((r) => (seen.has(r.candidateId) ? false : (seen.add(r.candidateId), true)))
          .map((r) => ({ candidateId: r.candidateId }));
      }),
    },
    notification: {
      findMany: jest.fn(async ({ where }: { where: { userId: { in: string[] }; type: { in: NotificationType[] } } }) => {
        return notifications
          .filter((n) => where.userId.in.includes(n.userId) && where.type.in.includes(n.type))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((n) => ({ userId: n.userId, type: n.type, status: n.status }));
      }),
    },
  };
}

function makeService(seed: Parameters<typeof fakePrisma>[0]) {
  const prisma = fakePrisma(seed);
  // listActionsForAdmin never touches notifications/refundJob — both unused here.
  const service = new AccountService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

const t = (iso: string) => new Date(iso);

describe('AccountService.listActionsForAdmin', () => {
  it('never returns reasonText, even when the underlying row still has it (a non-deleted DEACTIVATED row)', async () => {
    const { service } = makeService({
      actions: [
        {
          id: 'a1', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED,
          reasonCategory: AccountActionReason.PRIVACY_CONCERNS, reasonText: 'my real name is written here',
          createdAt: t('2026-01-01'), deletedAt: null, deactivatedAt: t('2026-01-01'),
        },
      ],
    });

    const [row] = await service.listActionsForAdmin();

    expect(row).not.toHaveProperty('reasonText');
    expect(JSON.stringify(row)).not.toContain('my real name');
    expect(row.reasonCategory).toBe(AccountActionReason.PRIVACY_CONCERNS);
  });

  it('candidateRef is a short id derived from candidateProfileId, never a name or email', async () => {
    const { service } = makeService({
      actions: [
        { id: 'a1', candidateProfileId: 'cp1abcdef', userId: 'u1', type: AccountActionType.DELETED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: t('2026-01-01'), deactivatedAt: null },
      ],
    });

    const [row] = await service.listActionsForAdmin();

    expect(row.candidateRef).toBe('cp1abcde'); // first 8 chars
    expect(row).not.toHaveProperty('fullName');
    expect(row).not.toHaveProperty('email');
  });

  it('orders most-recent-first regardless of insertion order', async () => {
    const { service } = makeService({
      actions: [
        { id: 'old', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: null, deactivatedAt: null },
        { id: 'new', candidateProfileId: 'cp2', userId: 'u2', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-06-01'), deletedAt: null, deactivatedAt: null },
      ],
    });

    const rows = await service.listActionsForAdmin();

    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  describe('filters', () => {
    const actions: FakeAction[] = [
      { id: 'deact', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-03-01'), deletedAt: null, deactivatedAt: t('2026-03-01') },
      { id: 'del', candidateProfileId: 'cp2', userId: 'u2', type: AccountActionType.DELETED, reasonCategory: null, reasonText: null, createdAt: t('2026-06-01'), deletedAt: t('2026-06-01'), deactivatedAt: null },
    ];

    it('filters by action type', async () => {
      const { service } = makeService({ actions });
      const rows = await service.listActionsForAdmin({ type: AccountActionType.DELETED });
      expect(rows.map((r) => r.id)).toEqual(['del']);
    });

    it('filters by date range', async () => {
      const { service } = makeService({ actions });
      const rows = await service.listActionsForAdmin({ from: '2026-04-01', to: '2026-12-31' });
      expect(rows.map((r) => r.id)).toEqual(['del']);
    });
  });

  describe('confirmationEmailStatus — ascending zip pairing', () => {
    it('pairs each DEACTIVATED action with the Nth ACCOUNT_DEACTIVATED email for that user, in order', async () => {
      const { service } = makeService({
        actions: [
          { id: 'first', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: null, deactivatedAt: null },
          { id: 'reactivate', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.REACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-05'), deletedAt: null, deactivatedAt: null },
          { id: 'second', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-10'), deletedAt: null, deactivatedAt: t('2026-01-10') },
        ],
        notifications: [
          { userId: 'u1', type: NotificationType.ACCOUNT_DEACTIVATED, status: NotificationStatus.SENT, createdAt: t('2026-01-01T00:00:01') },
          { userId: 'u1', type: NotificationType.ACCOUNT_DEACTIVATED, status: NotificationStatus.FAILED, createdAt: t('2026-01-10T00:00:01') },
        ],
      });

      const rows = await service.listActionsForAdmin();
      const byId = new Map(rows.map((r) => [r.id, r]));

      expect(byId.get('first')!.confirmationEmailStatus).toBe(NotificationStatus.SENT);
      expect(byId.get('second')!.confirmationEmailStatus).toBe(NotificationStatus.FAILED);
      // REACTIVATED sends no email at all — never confused with a "sent" or "failed" state.
      expect(byId.get('reactivate')!.confirmationEmailStatus).toBeNull();
    });

    it('a failed confirmation email marks the row as needing attention', async () => {
      const { service } = makeService({
        actions: [
          { id: 'a1', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DELETED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: t('2026-01-01'), deactivatedAt: null },
        ],
        notifications: [{ userId: 'u1', type: NotificationType.ACCOUNT_DELETED, status: NotificationStatus.FAILED, createdAt: t('2026-01-01T00:00:01') }],
      });

      const [row] = await service.listActionsForAdmin();

      expect(row.confirmationEmailStatus).toBe(NotificationStatus.FAILED);
      expect(row.needsAttention).toBe(true);
    });
  });

  describe('live downstream signals — only attached to the candidate\'s current action', () => {
    it('attaches pipelinesUnavailable and candidateHasFailedRefund to the latest DEACTIVATED action', async () => {
      const { service } = makeService({
        actions: [
          { id: 'a1', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: null, deactivatedAt: t('2026-01-01') },
        ],
        entries: [
          { candidateId: 'cp1', stage: ShortlistStage.CANDIDATE_UNAVAILABLE },
          { candidateId: 'cp1', stage: ShortlistStage.CANDIDATE_UNAVAILABLE },
          { candidateId: 'cp1', stage: ShortlistStage.SHORTLISTED }, // not unavailable — must not count
        ],
        requests: [{ candidateId: 'cp1', status: AssessmentRequestStatus.REFUND_FAILED }],
      });

      const [row] = await service.listActionsForAdmin();

      expect(row.pipelinesUnavailable).toBe(2);
      expect(row.candidateHasFailedRefund).toBe(true);
      expect(row.needsAttention).toBe(true);
    });

    it('does not attach live signals to an older action once a later action supersedes it', async () => {
      const { service } = makeService({
        actions: [
          { id: 'old-deact', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: null, deactivatedAt: null },
          { id: 'reactivate', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.REACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-02-01'), deletedAt: null, deactivatedAt: null },
        ],
        entries: [{ candidateId: 'cp1', stage: ShortlistStage.CANDIDATE_UNAVAILABLE }],
        requests: [{ candidateId: 'cp1', status: AssessmentRequestStatus.REFUND_FAILED }],
      });

      const rows = await service.listActionsForAdmin();
      const oldRow = rows.find((r) => r.id === 'old-deact')!;
      const reactivateRow = rows.find((r) => r.id === 'reactivate')!;

      // The superseded DEACTIVATED row no longer claims live effects that have moved on.
      expect(oldRow.pipelinesUnavailable).toBeNull();
      expect(oldRow.candidateHasFailedRefund).toBe(false);
      // REACTIVATED never carries these signals either — reactivation has no "pipelines unavailable" concept of its own.
      expect(reactivateRow.pipelinesUnavailable).toBeNull();
    });

    it('a DELETED action is always terminal, so it always carries the live signals', async () => {
      const { service } = makeService({
        actions: [
          { id: 'del', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DELETED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: t('2026-01-01'), deactivatedAt: null },
        ],
        entries: [{ candidateId: 'cp1', stage: ShortlistStage.CANDIDATE_UNAVAILABLE }],
      });

      const [row] = await service.listActionsForAdmin();

      expect(row.pipelinesUnavailable).toBe(1);
    });
  });

  describe('status filter (derived, not a stored column)', () => {
    it('NEEDS_ATTENTION returns only rows with a failure signal', async () => {
      const { service } = makeService({
        actions: [
          { id: 'clean', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: null, deactivatedAt: t('2026-01-01') },
          { id: 'stuck', candidateProfileId: 'cp2', userId: 'u2', type: AccountActionType.DELETED, reasonCategory: null, reasonText: null, createdAt: t('2026-02-01'), deletedAt: t('2026-02-01'), deactivatedAt: null },
        ],
        requests: [{ candidateId: 'cp2', status: AssessmentRequestStatus.REFUND_FAILED }],
      });

      const rows = await service.listActionsForAdmin({ status: 'NEEDS_ATTENTION' });

      expect(rows.map((r) => r.id)).toEqual(['stuck']);
    });

    it('CLEAN returns only rows without a failure signal', async () => {
      const { service } = makeService({
        actions: [
          { id: 'clean', candidateProfileId: 'cp1', userId: 'u1', type: AccountActionType.DEACTIVATED, reasonCategory: null, reasonText: null, createdAt: t('2026-01-01'), deletedAt: null, deactivatedAt: t('2026-01-01') },
          { id: 'stuck', candidateProfileId: 'cp2', userId: 'u2', type: AccountActionType.DELETED, reasonCategory: null, reasonText: null, createdAt: t('2026-02-01'), deletedAt: t('2026-02-01'), deactivatedAt: null },
        ],
        requests: [{ candidateId: 'cp2', status: AssessmentRequestStatus.REFUND_FAILED }],
      });

      const rows = await service.listActionsForAdmin({ status: 'CLEAN' });

      expect(rows.map((r) => r.id)).toEqual(['clean']);
    });
  });
});
