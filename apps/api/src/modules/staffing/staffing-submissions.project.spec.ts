import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StaffingSubmissionsService } from './staffing-submissions.service';

/** Hiring projects phase 2: submitting applicants of agency postings, linked to a project role. */
function setup() {
  const prisma = {
    staffingClient: { findUnique: jest.fn(async () => ({ id: 'c1', orgId: 'o1', name: 'Globex', nameKey: 'globex', domain: null, archivedAt: null })) },
    candidateProfile: { findFirst: jest.fn(async () => ({ id: 'cand1', userId: 'u9' })) },
    staffingAvailabilityRequest: { findFirst: jest.fn(async () => null as { id: string } | null) },
    application: { findFirst: jest.fn(async () => ({ id: 'a1' }) as { id: string } | null) },
    projectRole: { findFirst: jest.fn(async () => ({ project: { clientId: 'c1' } }) as { project: { clientId: string | null } } | null) },
    staffingSubmission: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', status: 'PENDING_CONSENT', ...data, organization: { name: 'Talent Partners' } })),
    },
  };
  const svc = new StaffingSubmissionsService(prisma as unknown as PrismaService, {} as NotificationsService);
  const internals = svc as unknown as { assertNoConflict: jest.Mock; notify: jest.Mock };
  internals.assertNoConflict = jest.fn(async () => undefined);
  internals.notify = jest.fn(async () => undefined);
  return { svc, prisma };
}

const dto = { candidateId: '00000000-0000-0000-0000-000000000001', clientId: 'c1', roleTitle: 'Data Engineer' };

describe('StaffingSubmissionsService.createSubmission (agency postings)', () => {
  it('lets a recruiter submit someone who applied to one of its jobs, linked to the project role', async () => {
    const { svc, prisma } = setup();
    await svc.createSubmission('o1', 'u1', { ...dto, projectRoleId: 'r1' });
    expect(prisma.application.findFirst).toHaveBeenCalledWith({ where: { candidateProfileId: 'cand1', job: { orgId: 'o1' } }, select: { id: true } });
    expect(prisma.staffingSubmission.create.mock.calls[0][0].data).toMatchObject({ projectRoleId: 'r1', clientId: 'c1' });
  });

  it('still refuses someone who neither applied nor said they are available', async () => {
    const { svc, prisma } = setup();
    prisma.application.findFirst.mockResolvedValue(null);
    await expect(svc.createSubmission('o1', 'u1', dto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses a project role that belongs to another client's project", async () => {
    const { svc, prisma } = setup();
    prisma.projectRole.findFirst.mockResolvedValue({ project: { clientId: 'c2' } });
    await expect(svc.createSubmission('o1', 'u1', { ...dto, projectRoleId: 'r1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.staffingSubmission.create).not.toHaveBeenCalled();
  });
});
