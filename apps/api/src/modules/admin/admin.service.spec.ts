import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

const ORG_ID = 'org-1';
const ADMIN_ID = 'platform-admin-1';

interface OrgRow {
  id: string;
  name: string;
  deactivatedAt: Date | null;
  deactivatedByUserId: string | null;
}

/**
 * Focused fake — only the AdminService.reactivateOrg surface (this repo has
 * no prior admin.service.spec.ts; not attempting full coverage of the rest
 * of that large, pre-existing service here).
 */
function makeService(org: OrgRow | null, members: string[] = []) {
  const adminAccessLogCreate = jest.fn(async () => undefined);
  const organizationUpdate = jest.fn(async ({ data }: { data: Partial<OrgRow> }) => {
    if (org) Object.assign(org, data);
    return { ...org };
  });
  const prisma = {
    organization: {
      findUnique: jest.fn(async () => org),
      update: organizationUpdate,
    },
    orgMember: {
      findMany: jest.fn(async () => members.map((userId) => ({ userId }))),
    },
    adminAccessLog: {
      create: adminAccessLogCreate,
    },
  };
  const sendEmail = jest.fn(async (_userId: string, ..._rest: unknown[]) => undefined);
  const notifications = { sendEmail } as never;
  const entitlements = {} as never;
  const svc = new AdminService(prisma as never, entitlements, notifications);
  return { svc, prisma, adminAccessLogCreate, organizationUpdate, sendEmail };
}

describe('AdminService.reactivateOrg', () => {
  it('throws NotFoundException for an unknown org', async () => {
    const { svc } = makeService(null);
    await expect(svc.reactivateOrg(ORG_ID, ADMIN_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when the org is not deactivated', async () => {
    const org: OrgRow = { id: ORG_ID, name: 'Acme', deactivatedAt: null, deactivatedByUserId: null };
    const { svc } = makeService(org);
    await expect(svc.reactivateOrg(ORG_ID, ADMIN_ID)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears deactivatedAt/-ByUserId, logs an AdminAccessLog entry, and emails every member', async () => {
    const org: OrgRow = { id: ORG_ID, name: 'Acme', deactivatedAt: new Date(), deactivatedByUserId: 'admin-x' };
    const { svc, adminAccessLogCreate, sendEmail } = makeService(org, ['member-1', 'member-2']);

    await svc.reactivateOrg(ORG_ID, ADMIN_ID);

    expect(org.deactivatedAt).toBeNull();
    expect(org.deactivatedByUserId).toBeNull();

    expect(adminAccessLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adminUserId: ADMIN_ID, action: 'ORG_REACTIVATED', organizationId: ORG_ID }),
      }),
    );

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls.map((c) => c[0])).toEqual(['member-1', 'member-2']);
  });

  it('never throws if the AdminAccessLog write fails (best-effort, logged not thrown)', async () => {
    const org: OrgRow = { id: ORG_ID, name: 'Acme', deactivatedAt: new Date(), deactivatedByUserId: null };
    const { svc, prisma } = makeService(org, ['member-1']);
    (prisma.adminAccessLog.create as jest.Mock).mockRejectedValueOnce(new Error('db hiccup'));

    await expect(svc.reactivateOrg(ORG_ID, ADMIN_ID)).resolves.toBeDefined();
  });
});
