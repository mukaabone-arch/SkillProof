import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

const ADMIN_ID = 'platform-admin-1';

interface BlockRow {
  id: string;
  userId: string;
  skillId: string | null;
  triggerAttemptIds: string[];
  createdAt: Date;
  liftedAt: Date | null;
  liftedByUserId: string | null;
  liftedNote: string | null;
  expiresAt: Date;
}

/** Focused fake — only the AdminService.listAssessmentBlocks/liftAssessmentBlock surface, same convention as admin.service.spec.ts's own reactivateOrg-only fake. */
function makeService(blocks: BlockRow[] = [], attempts: { id: string }[] = []) {
  const adminAccessLogCreate = jest.fn(async () => undefined);
  const assessmentBlockUpdate = jest.fn(async ({ where, data }: any) => {
    const row = blocks.find((b) => b.id === where.id)!;
    Object.assign(row, data);
    return { ...row };
  });
  const prisma = {
    assessmentBlock: {
      findMany: jest.fn(async () => [...blocks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
      findUnique: jest.fn(async ({ where }: any) => blocks.find((b) => b.id === where.id) ?? null),
      update: assessmentBlockUpdate,
    },
    attempt: {
      findMany: jest.fn(async ({ where }: any) => attempts.filter((a) => where.id.in.includes(a.id))),
    },
    adminAccessLog: { create: adminAccessLogCreate },
  };
  const notifications = {} as never;
  const entitlements = {} as never;
  const svc = new AdminService(prisma as never, entitlements, notifications);
  return { svc, prisma, adminAccessLogCreate, assessmentBlockUpdate };
}

function block(overrides: Partial<BlockRow> & { id: string; userId: string }): BlockRow {
  return {
    skillId: 'skill-1',
    triggerAttemptIds: [],
    createdAt: new Date(),
    liftedAt: null,
    liftedByUserId: null,
    liftedNote: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

describe('AdminService.listAssessmentBlocks', () => {
  it('summarizes raised/lifted/currently-active counts, never deleting a lifted or expired row', async () => {
    const active = block({ id: 'b-active', userId: 'user-1' });
    const lifted = block({ id: 'b-lifted', userId: 'user-2', liftedAt: new Date(), liftedByUserId: ADMIN_ID });
    const expired = block({ id: 'b-expired', userId: 'user-3', expiresAt: new Date(Date.now() - 1000) });
    const { svc } = makeService([active, lifted, expired]);

    const result = await svc.listAssessmentBlocks();

    expect(result.summary).toEqual({ totalRaised: 3, totalLifted: 1, currentlyActive: 1 });
    expect(result.blocks.map((b) => b.id)).toEqual(['b-active', 'b-lifted', 'b-expired']);
  });

  it('resolves each block\'s trigger attempts for admin review', async () => {
    const b = block({ id: 'b-1', userId: 'user-1', triggerAttemptIds: ['attempt-1', 'attempt-2'] });
    const { svc } = makeService([b], [{ id: 'attempt-1' }, { id: 'attempt-2' }]);

    const result = await svc.listAssessmentBlocks();

    expect(result.blocks[0].triggerAttempts).toEqual([{ id: 'attempt-1' }, { id: 'attempt-2' }]);
  });
});

describe('AdminService.liftAssessmentBlock', () => {
  it('throws NotFoundException for an unknown block', async () => {
    const { svc } = makeService([]);
    await expect(svc.liftAssessmentBlock('missing', ADMIN_ID, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException if already lifted', async () => {
    const b = block({ id: 'b-1', userId: 'user-1', liftedAt: new Date(), liftedByUserId: 'someone-else' });
    const { svc } = makeService([b]);
    await expect(svc.liftAssessmentBlock('b-1', ADMIN_ID, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets liftedAt/liftedByUserId/liftedNote, logs an AdminAccessLog entry, and never deletes the row', async () => {
    const b = block({ id: 'b-1', userId: 'user-1' });
    const { svc, prisma, adminAccessLogCreate } = makeService([b]);

    const updated = await svc.liftAssessmentBlock('b-1', ADMIN_ID, { note: 'Appeal reviewed, false positive.' });

    expect(updated.liftedAt).toBeInstanceOf(Date);
    expect(updated.liftedByUserId).toBe(ADMIN_ID);
    expect(updated.liftedNote).toBe('Appeal reviewed, false positive.');
    expect(b.liftedAt).not.toBeNull(); // the row itself, still present — never deleted
    expect(prisma.assessmentBlock.findUnique).toHaveBeenCalled();
    expect(adminAccessLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adminUserId: ADMIN_ID, action: 'ASSESSMENT_BLOCK_LIFTED', targetType: 'AssessmentBlock', targetId: 'b-1' }),
      }),
    );
  });

  it('never throws if the AdminAccessLog write fails (best-effort, logged not thrown)', async () => {
    const b = block({ id: 'b-1', userId: 'user-1' });
    const { svc, prisma } = makeService([b]);
    (prisma.adminAccessLog.create as jest.Mock).mockRejectedValueOnce(new Error('db hiccup'));

    await expect(svc.liftAssessmentBlock('b-1', ADMIN_ID, {})).resolves.toBeDefined();
  });
});
