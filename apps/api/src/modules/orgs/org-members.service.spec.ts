import { OrgInvitationStatus, Role } from '@prisma/client';
import { OrgMembersService } from './org-members.service';

interface MemberRow {
  id: string;
  userId: string;
  organizationId: string;
  createdAt: Date;
  user: { id: string; email: string | null; phone: string | null; role: Role };
}
interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  invitedByUserId: string;
  status: OrgInvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

const ORG = 'org-1';

/** In-memory stand-in for PrismaService — just enough of orgMember/orgInvitation/organization/user to exercise OrgMembersService without a real DB. */
function fakePrisma(members: MemberRow[] = [], invitations: InvitationRow[] = []) {
  let nextId = 1;

  return {
    _members: members,
    _invitations: invitations,
    organization: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== ORG) throw new Error('not found');
        return { id: ORG, name: 'Acme Inc.' };
      }),
    },
    orgMember: {
      findMany: jest.fn(async ({ where }: { where: { organizationId: string } }) =>
        members.filter((m) => m.organizationId === where.organizationId),
      ),
      findFirst: jest.fn(async ({ where }: { where: { organizationId: string; user: { email: string } } }) =>
        members.find((m) => m.organizationId === where.organizationId && m.user.email === where.user.email) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => members.find((m) => m.id === where.id) ?? null),
      count: jest.fn(async ({ where }: { where: { organizationId: string; user?: { role: Role } } }) =>
        members.filter(
          (m) => m.organizationId === where.organizationId && (!where.user || m.user.role === where.user.role),
        ).length,
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const idx = members.findIndex((m) => m.id === where.id);
        members.splice(idx, 1);
      }),
    },
    orgInvitation: {
      findMany: jest.fn(async ({ where }: { where: { organizationId: string; status: { in: OrgInvitationStatus[] } } }) =>
        invitations
          .filter((i) => i.organizationId === where.organizationId && where.status.in.includes(i.status))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { organizationId: string; email: string; status: OrgInvitationStatus } }) =>
          invitations.find(
            (i) => i.organizationId === where.organizationId && i.email === where.email && i.status === where.status,
          ) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => invitations.find((i) => i.id === where.id) ?? null),
      count: jest.fn(
        async ({ where }: { where: { organizationId: string; status: OrgInvitationStatus; expiresAt: { gt: Date } } }) =>
          invitations.filter(
            (i) =>
              i.organizationId === where.organizationId &&
              i.status === where.status &&
              i.expiresAt.getTime() > where.expiresAt.gt.getTime(),
          ).length,
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: { organizationId: string; email: string; invitedByUserId: string; expiresAt: Date };
        }) => {
          const row: InvitationRow = {
            id: `invite-${nextId++}`,
            status: OrgInvitationStatus.PENDING,
            acceptedAt: null,
            createdAt: new Date(),
            ...data,
          };
          invitations.push(row);
          return row;
        },
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<InvitationRow> }) => {
        const row = invitations.find((i) => i.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { organizationId: string; status: OrgInvitationStatus; expiresAt: { lte: Date } };
          data: Partial<InvitationRow>;
        }) => {
          let count = 0;
          for (const row of invitations) {
            if (
              row.organizationId === where.organizationId &&
              row.status === where.status &&
              row.expiresAt.getTime() <= where.expiresAt.lte.getTime()
            ) {
              Object.assign(row, data);
              count += 1;
            }
          }
          return { count };
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const idx = invitations.findIndex((i) => i.id === where.id);
        invitations.splice(idx, 1);
      }),
    },
    user: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { role: Role } }) => {
        const member = members.find((m) => m.userId === where.id);
        if (member) member.user.role = data.role;
        return { id: where.id, role: data.role };
      }),
    },
  };
}

function member(overrides: Partial<MemberRow> = {}): MemberRow {
  const userId = overrides.userId ?? `user-${Math.random().toString(36).slice(2)}`;
  return {
    id: `member-${Math.random().toString(36).slice(2)}`,
    organizationId: ORG,
    createdAt: new Date(),
    ...overrides,
    userId,
    user: { id: userId, email: `${userId}@acme.com`, phone: null, role: Role.EMPLOYER_MEMBER, ...overrides.user },
  };
}

function admin(overrides: Partial<MemberRow> = {}): MemberRow {
  return member({ ...overrides, user: { ...overrides.user, role: Role.EMPLOYER_ADMIN } as MemberRow['user'] });
}

function makeService(members: MemberRow[] = [], invitations: InvitationRow[] = []) {
  const prisma = fakePrisma(members, invitations);
  const emailProvider = { send: jest.fn(async () => undefined) };
  const service = new OrgMembersService(prisma as never, emailProvider as never);
  return { service, prisma, emailProvider, members, invitations };
}

describe('OrgMembersService', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('list', () => {
    it('returns members and pending invitations with an accurate seat count', async () => {
      const a = admin();
      const m = member();
      const invite = { organizationId: ORG, email: 'pending@acme.com', invitedByUserId: a.userId, status: OrgInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 1000), acceptedAt: null, createdAt: new Date(), id: 'invite-1' };
      const { service } = makeService([a, m], [invite]);

      const result = await service.list(ORG);

      expect(result.members).toHaveLength(2);
      expect(result.invitations).toHaveLength(1);
      expect(result.seatLimit).toBe(5);
      expect(result.seatsUsed).toBe(3); // 2 members + 1 pending invite
      expect(result.seatsRemaining).toBe(2);
    });

    it('lazily flips an overdue PENDING invitation to EXPIRED and excludes it from the seat count', async () => {
      const a = admin();
      const overdue = { organizationId: ORG, email: 'late@acme.com', invitedByUserId: a.userId, status: OrgInvitationStatus.PENDING, expiresAt: new Date(Date.now() - 1000), acceptedAt: null, createdAt: new Date(), id: 'invite-1' };
      const { service, invitations } = makeService([a], [overdue]);

      const result = await service.list(ORG);

      expect(invitations[0].status).toBe(OrgInvitationStatus.EXPIRED);
      expect(result.seatsUsed).toBe(1); // just the admin — the expired invite no longer reserves a seat
      expect(result.invitations[0].status).toBe(OrgInvitationStatus.EXPIRED);
    });
  });

  describe('invite', () => {
    it('creates a PENDING invitation', async () => {
      process.env.NODE_ENV = 'test';
      const a = admin();
      const { service, invitations } = makeService([a]);

      const result = await service.invite(ORG, a.userId, 'New@Acme.com');

      expect(result.status).toBe(OrgInvitationStatus.PENDING);
      expect(invitations).toHaveLength(1);
      expect(invitations[0].email).toBe('new@acme.com'); // normalized
    });

    it('rejects inviting an email that is already a member of this org', async () => {
      const a = admin();
      const existing = member({ user: { role: Role.EMPLOYER_MEMBER, email: 'taken@acme.com' } as MemberRow['user'] });
      const { service } = makeService([a, existing]);

      await expect(service.invite(ORG, a.userId, 'taken@acme.com')).rejects.toThrow(
        'This email is already a member of your organization.',
      );
    });

    it('rejects a second invite to the same email while one is already pending', async () => {
      const a = admin();
      const invite = { organizationId: ORG, email: 'invitee@acme.com', invitedByUserId: a.userId, status: OrgInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 1000), acceptedAt: null, createdAt: new Date(), id: 'invite-1' };
      const { service } = makeService([a], [invite]);

      await expect(service.invite(ORG, a.userId, 'invitee@acme.com')).rejects.toThrow(
        'An invitation is already pending for this email.',
      );
    });

    it('blocks inviting a 6th seat once 5 are already used (members + pending invitations combined)', async () => {
      const a = admin();
      const fourMoreMembers = Array.from({ length: 4 }, () => member());
      const { service } = makeService([a, ...fourMoreMembers]);

      await expect(service.invite(ORG, a.userId, 'sixth@acme.com')).rejects.toThrow(
        /reached its 5-member seat limit/,
      );
    });

    it('a pending invitation counts toward the cap just like a real member', async () => {
      const a = admin();
      const threeMoreMembers = Array.from({ length: 3 }, () => member());
      const pendingInvite = { organizationId: ORG, email: 'reserved@acme.com', invitedByUserId: a.userId, status: OrgInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 1000), acceptedAt: null, createdAt: new Date(), id: 'invite-1' };
      // 4 members + 1 pending invite = 5 seats used already.
      const { service } = makeService([a, ...threeMoreMembers], [pendingInvite]);

      await expect(service.invite(ORG, a.userId, 'sixth@acme.com')).rejects.toThrow(
        /reached its 5-member seat limit/,
      );
    });

    it('an expired pending invitation frees its seat back up', async () => {
      const a = admin();
      const threeMoreMembers = Array.from({ length: 3 }, () => member());
      const expiredInvite = { organizationId: ORG, email: 'gone@acme.com', invitedByUserId: a.userId, status: OrgInvitationStatus.PENDING, expiresAt: new Date(Date.now() - 1000), acceptedAt: null, createdAt: new Date(), id: 'invite-1' };
      const { service } = makeService([a, ...threeMoreMembers], [expiredInvite]);

      // 4 members + 1 EXPIRED (not counted) = room for exactly one more.
      await expect(service.invite(ORG, a.userId, 'sixth@acme.com')).resolves.toMatchObject({ status: OrgInvitationStatus.PENDING });
    });

    it('rolls back the invitation row if the email fails to send, so the same address can be retried immediately', async () => {
      process.env.NODE_ENV = 'production';
      const a = admin();
      const { service, prisma, emailProvider, invitations } = makeService([a]);
      emailProvider.send.mockRejectedValueOnce(new Error('Resend outage'));

      await expect(service.invite(ORG, a.userId, 'flaky@acme.com')).rejects.toThrow(
        'Could not send the invitation email.',
      );
      expect(invitations).toHaveLength(0);
      expect(prisma.orgInvitation.create).toHaveBeenCalledTimes(1);
    });

    it('rejects inviting a free-provider domain, with the invite-specific message and code', async () => {
      const a = admin();
      const { service, invitations } = makeService([a]);

      await expect(service.invite(ORG, a.userId, 'someone@gmail.com')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED', message: 'Team members must be invited using a company email address.' },
      });
      expect(invitations).toHaveLength(0); // never created — rejected before the write
    });

    it('rejects inviting a disposable/temp-mail domain the same way', async () => {
      const a = admin();
      const { service } = makeService([a]);

      // mailinator.com is in the vendored disposable-domain snapshot (see employer-email-domain.spec.ts).
      await expect(service.invite(ORG, a.userId, 'someone@mailinator.com')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
    });

    it('checked before any other validation — a blocked domain is rejected even when it would also collide on membership/seats', async () => {
      const a = admin();
      const existing = member({ user: { role: Role.EMPLOYER_MEMBER, email: 'taken@gmail.com' } as MemberRow['user'] });
      const { service } = makeService([a, existing]);

      // Same email as an existing member AND a blocked domain — the domain
      // rejection must win, proving it runs first (a membership collision
      // would give a different, more confusing message for what's
      // fundamentally an ineligible-domain problem).
      await expect(service.invite(ORG, a.userId, 'taken@gmail.com')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
    });

    it('a company-domain invite is completely unaffected', async () => {
      process.env.NODE_ENV = 'test';
      const a = admin();
      const { service } = makeService([a]);

      await expect(service.invite(ORG, a.userId, 'new-hire@acme.com')).resolves.toMatchObject({
        status: OrgInvitationStatus.PENDING,
      });
    });
  });

  describe('revokeInvitation', () => {
    it('revokes a pending invitation, freeing its seat', async () => {
      const a = admin();
      const invite = { organizationId: ORG, email: 'invitee@acme.com', invitedByUserId: a.userId, status: OrgInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 1000), acceptedAt: null, createdAt: new Date(), id: 'invite-1' };
      const { service, invitations } = makeService([a], [invite]);

      await service.revokeInvitation(ORG, 'invite-1');

      expect(invitations[0].status).toBe(OrgInvitationStatus.REVOKED);
    });

    it('rejects revoking an invitation that belongs to a different organization', async () => {
      const a = admin();
      const foreignInvite = { organizationId: 'org-other', email: 'x@acme.com', invitedByUserId: a.userId, status: OrgInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 1000), acceptedAt: null, createdAt: new Date(), id: 'invite-1' };
      const { service } = makeService([a], [foreignInvite]);

      await expect(service.revokeInvitation(ORG, 'invite-1')).rejects.toThrow();
    });
  });

  describe('remove', () => {
    it('removes a member', async () => {
      const a = admin();
      const m = member();
      const { service, members } = makeService([a, m]);

      await service.remove(ORG, a.userId, m.id);

      expect(members).toHaveLength(1);
    });

    it('blocks removing the last admin', async () => {
      const a = admin();
      const m = member();
      const { service, members } = makeService([a, m]);

      await expect(service.remove(ORG, a.userId, a.id)).rejects.toThrow(
        'An organization must always have at least one admin.',
      );
      expect(members).toHaveLength(2); // unchanged
    });

    it('allows removing an admin when a second admin exists', async () => {
      const a1 = admin();
      const a2 = admin();
      const { service, members } = makeService([a1, a2]);

      await service.remove(ORG, a1.userId, a1.id);

      expect(members).toHaveLength(1);
    });

    it('rejects removing a member from a different organization (IDOR)', async () => {
      const a = admin();
      const foreignMember = member({ organizationId: 'org-other' });
      const { service } = makeService([a, foreignMember]);

      await expect(service.remove(ORG, a.userId, foreignMember.id)).rejects.toThrow();
    });
  });

  describe('promote', () => {
    it('promotes a member to admin', async () => {
      const a = admin();
      const m = member();
      const { service } = makeService([a, m]);

      const result = await service.promote(ORG, m.id);

      expect(result.role).toBe(Role.EMPLOYER_ADMIN);
      expect(m.user.role).toBe(Role.EMPLOYER_ADMIN);
    });

    it('rejects promoting someone who is already an admin', async () => {
      const a = admin();
      const { service } = makeService([a]);

      await expect(service.promote(ORG, a.id)).rejects.toThrow('This member is already an admin.');
    });
  });

  describe('demote', () => {
    it('demotes an admin to member when another admin remains', async () => {
      const a1 = admin();
      const a2 = admin();
      const { service } = makeService([a1, a2]);

      const result = await service.demote(ORG, a1.id);

      expect(result.role).toBe(Role.EMPLOYER_MEMBER);
      expect(a1.user.role).toBe(Role.EMPLOYER_MEMBER);
    });

    it('blocks demoting the last admin — the account-recovery invariant', async () => {
      const a = admin();
      const m = member();
      const { service } = makeService([a, m]);

      await expect(service.demote(ORG, a.id)).rejects.toThrow('An organization must always have at least one admin.');
      expect(a.user.role).toBe(Role.EMPLOYER_ADMIN); // unchanged
    });

    it('rejects demoting someone who is not an admin', async () => {
      const a = admin();
      const m = member();
      const { service } = makeService([a, m]);

      await expect(service.demote(ORG, m.id)).rejects.toThrow('This member is not an admin.');
    });
  });
});
