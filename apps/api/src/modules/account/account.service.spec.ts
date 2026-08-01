import { AccountActionType, ShortlistStage } from '@prisma/client';
import { AccountService } from './account.service';

interface FakeProfile {
  id: string;
  userId: string;
  deactivatedAt: Date | null;
  deletedAt: Date | null;
  fullName: string | null;
  photoKey: string | null;
  resumeS3Key: string | null;
}
interface FakeShortlistEntry {
  id: string;
  candidateId: string;
  addedByUserId: string;
  stage: ShortlistStage;
  preUnavailableStage: ShortlistStage | null;
  organization: { name: string };
  job: { title: string } | null;
}
interface FakeApplication {
  id: string;
  candidateProfileId: string;
  status: string;
}
interface FakeAccountAction {
  id: string;
  candidateProfileId: string;
  type: AccountActionType;
  reasonCategory: string | null;
  reasonText: string | null;
}
interface FakeUser {
  id: string;
  email: string | null;
  phone: string | null;
}

/**
 * Minimal in-memory stand-in for PrismaService, same convention as
 * auth.service.spec.ts's fakePrisma — just enough of each model
 * AccountService actually touches to exercise its real logic with no DB.
 */
function fakePrisma(seed: {
  profiles?: FakeProfile[];
  entries?: FakeShortlistEntry[];
  applications?: FakeApplication[];
  users?: FakeUser[];
}) {
  const profiles = seed.profiles ?? [];
  const entries = seed.entries ?? [];
  const applications = seed.applications ?? [];
  const users = seed.users ?? [];
  const accountActions: FakeAccountAction[] = [];
  let nextId = 1;

  return {
    candidateProfile: {
      findUnique: jest.fn(async ({ where }: { where: { userId?: string; id?: string } }) => {
        if (where.userId !== undefined) return profiles.find((p) => p.userId === where.userId) ?? null;
        if (where.id !== undefined) return profiles.find((p) => p.id === where.id) ?? null;
        return null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeProfile> }) => {
        const p = profiles.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return p;
      }),
    },
    shortlistEntry: {
      findMany: jest.fn(
        async ({ where }: { where: { candidateId?: string; stage?: unknown; preUnavailableStage?: unknown } }) => {
          return entries.filter((e) => {
            if (where.candidateId !== undefined && e.candidateId !== where.candidateId) return false;
            if (where.stage && typeof where.stage === 'object' && 'in' in (where.stage as object)) {
              const allowed = (where.stage as { in: ShortlistStage[] }).in;
              if (!allowed.includes(e.stage)) return false;
            } else if (where.stage !== undefined && e.stage !== where.stage) {
              return false;
            }
            if (where.preUnavailableStage && typeof where.preUnavailableStage === 'object') {
              if (e.preUnavailableStage === null) return false;
            }
            return true;
          });
        },
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeShortlistEntry> }) => {
        const e = entries.find((x) => x.id === where.id)!;
        Object.assign(e, data);
        return e;
      }),
    },
    application: {
      updateMany: jest.fn(async ({ where, data }: { where: { candidateProfileId: string; status: unknown }; data: { status: string } }) => {
        let count = 0;
        for (const a of applications) {
          if (a.candidateProfileId === where.candidateProfileId && a.status !== 'WITHDRAWN') {
            a.status = data.status;
            count++;
          }
        }
        return { count };
      }),
    },
    accountAction: {
      create: jest.fn(async ({ data }: { data: Omit<FakeAccountAction, 'id'> }) => {
        const row: FakeAccountAction = { id: `action-${nextId++}`, ...data };
        accountActions.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { candidateProfileId: string }; data: { reasonText: string | null } }) => {
        let count = 0;
        for (const a of accountActions) {
          if (a.candidateProfileId === where.candidateProfileId) {
            a.reasonText = data.reasonText;
            count++;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async () => [...accountActions].reverse()),
    },
    user: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = users.find((x) => x.id === where.id)!;
        Object.assign(u, data);
        return u;
      }),
    },
    identity: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    refreshToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    externalCredential: { updateMany: jest.fn(async () => ({ count: 0 })) },
    certification: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    // exposed for assertions
    _accountActions: accountActions,
    _entries: entries,
    _applications: applications,
    _users: users,
  };
}

function makeService(seed: Parameters<typeof fakePrisma>[0]) {
  const prisma = fakePrisma(seed);
  const sentEmails: { userId: string; type: string; subject: string }[] = [];
  const notifications = {
    sendEmail: jest.fn(async (userId: string, type: string, subject: string) => {
      sentEmails.push({ userId, type, subject });
    }),
  };
  const service = new AccountService(prisma as never, notifications as never);
  return { service, prisma, sentEmails, notifications };
}

const BASE_PROFILE: FakeProfile = {
  id: 'profile-1',
  userId: 'user-1',
  deactivatedAt: null,
  deletedAt: null,
  fullName: 'Ada Lovelace',
  photoKey: null,
  resumeS3Key: null,
};

describe('AccountService.deactivate', () => {
  it('sets deactivatedAt and records a DEACTIVATED action', async () => {
    const { service, prisma } = makeService({ profiles: [{ ...BASE_PROFILE }] });
    await service.deactivate('user-1', {});
    expect(prisma._users).toBeDefined();
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: 'user-1' } });
    expect(profile!.deactivatedAt).not.toBeNull();
    expect(prisma._accountActions).toHaveLength(1);
    expect(prisma._accountActions[0].type).toBe(AccountActionType.DEACTIVATED);
  });

  it('transitions live pipelines to CANDIDATE_UNAVAILABLE, remembers the prior stage, and notifies the employer without the reason', async () => {
    const entry: FakeShortlistEntry = {
      id: 'entry-1',
      candidateId: 'profile-1',
      addedByUserId: 'employer-1',
      stage: ShortlistStage.INTERVIEWING,
      preUnavailableStage: null,
      organization: { name: 'Acme' },
      job: { title: 'ML Engineer' },
    };
    const { service, prisma, sentEmails, notifications } = makeService({
      profiles: [{ ...BASE_PROFILE }],
      entries: [entry],
    });

    await service.deactivate('user-1', { reasonCategory: 'PRIVACY_CONCERNS', reasonText: 'secret personal reason' });

    expect(entry.stage).toBe(ShortlistStage.CANDIDATE_UNAVAILABLE);
    expect(entry.preUnavailableStage).toBe(ShortlistStage.INTERVIEWING);

    const employerEmail = sentEmails.find((e) => e.userId === 'employer-1');
    expect(employerEmail).toBeDefined();
    expect(employerEmail!.type).toBe('PIPELINE_CANDIDATE_UNAVAILABLE');
    // The reason must never reach the call NotificationsService.sendEmail
    // receives for the employer — check every argument, not just subject.
    const employerCall = notifications.sendEmail.mock.calls.find((c: unknown[]) => c[0] === 'employer-1')!;
    for (const arg of employerCall) {
      expect(JSON.stringify(arg)).not.toContain('secret personal reason');
      expect(JSON.stringify(arg)).not.toContain('PRIVACY_CONCERNS');
    }
  });

  it('does not touch pipelines that are only SHORTLISTED (not yet a live pipeline)', async () => {
    const entry: FakeShortlistEntry = {
      id: 'entry-1',
      candidateId: 'profile-1',
      addedByUserId: 'employer-1',
      stage: ShortlistStage.SHORTLISTED,
      preUnavailableStage: null,
      organization: { name: 'Acme' },
      job: null,
    };
    const { service } = makeService({ profiles: [{ ...BASE_PROFILE }], entries: [entry] });
    await service.deactivate('user-1', {});
    expect(entry.stage).toBe(ShortlistStage.SHORTLISTED);
  });

  it('withdraws pending applications', async () => {
    const app: FakeApplication = { id: 'app-1', candidateProfileId: 'profile-1', status: 'APPLIED' };
    const { service } = makeService({ profiles: [{ ...BASE_PROFILE }], applications: [app] });
    await service.deactivate('user-1', {});
    expect(app.status).toBe('WITHDRAWN');
  });

  it('sends the candidate their own confirmation email', async () => {
    const { service, sentEmails } = makeService({ profiles: [{ ...BASE_PROFILE }] });
    await service.deactivate('user-1', {});
    expect(sentEmails.some((e) => e.userId === 'user-1' && e.type === 'ACCOUNT_DEACTIVATED')).toBe(true);
  });

  it('rejects deactivating an already-deactivated account', async () => {
    const { service } = makeService({ profiles: [{ ...BASE_PROFILE, deactivatedAt: new Date() }] });
    await expect(service.deactivate('user-1', {})).rejects.toThrow('already deactivated');
  });

  it('rejects deactivating a deleted account', async () => {
    const { service } = makeService({ profiles: [{ ...BASE_PROFILE, deletedAt: new Date() }] });
    await expect(service.deactivate('user-1', {})).rejects.toThrow('deleted');
  });
});

describe('AccountService.reactivate', () => {
  it('clears deactivatedAt and restores a stranded pipeline to its prior stage', async () => {
    const entry: FakeShortlistEntry = {
      id: 'entry-1',
      candidateId: 'profile-1',
      addedByUserId: 'employer-1',
      stage: ShortlistStage.CANDIDATE_UNAVAILABLE,
      preUnavailableStage: ShortlistStage.OFFER,
      organization: { name: 'Acme' },
      job: null,
    };
    const { service, prisma } = makeService({
      profiles: [{ ...BASE_PROFILE, deactivatedAt: new Date() }],
      entries: [entry],
    });

    await service.reactivate('user-1');

    const profile = await prisma.candidateProfile.findUnique({ where: { userId: 'user-1' } });
    expect(profile!.deactivatedAt).toBeNull();
    expect(entry.stage).toBe(ShortlistStage.OFFER);
    expect(entry.preUnavailableStage).toBeNull();
  });

  it('rejects reactivating an account that was never deactivated', async () => {
    const { service } = makeService({ profiles: [{ ...BASE_PROFILE }] });
    await expect(service.reactivate('user-1')).rejects.toThrow('not deactivated');
  });

  it('rejects reactivating a deleted account', async () => {
    const { service } = makeService({ profiles: [{ ...BASE_PROFILE, deletedAt: new Date() }] });
    await expect(service.reactivate('user-1')).rejects.toThrow('deleted');
  });
});

describe('AccountService.delete', () => {
  it('requires the literal confirmation string', async () => {
    const { service } = makeService({ profiles: [{ ...BASE_PROFILE }] });
    await expect(service.delete('user-1', { confirmation: 'delete' })).rejects.toThrow('Type DELETE');
    await expect(service.delete('user-1', { confirmation: '' })).rejects.toThrow('Type DELETE');
  });

  it('anonymizes the profile and the user record', async () => {
    const { service, prisma } = makeService({
      profiles: [{ ...BASE_PROFILE }],
      users: [{ id: 'user-1', email: 'ada@example.com', phone: '+911234567890' }],
    });
    await service.delete('user-1', { confirmation: 'DELETE' });

    const profile = await prisma.candidateProfile.findUnique({ where: { userId: 'user-1' } });
    expect(profile!.fullName).toBeNull();
    expect(profile!.deletedAt).not.toBeNull();
    const user = prisma._users.find((u) => u.id === 'user-1')!;
    expect(user.email).toBeNull();
    expect(user.phone).toBeNull();
  });

  it('sends the confirmation email before the email address is cleared', async () => {
    const { service, notifications } = makeService({
      profiles: [{ ...BASE_PROFILE }],
      users: [{ id: 'user-1', email: 'ada@example.com', phone: null }],
    });
    await service.delete('user-1', { confirmation: 'DELETE' });
    const deleteEmailCallIndex = notifications.sendEmail.mock.calls.findIndex(
      (c: unknown[]) => c[1] === 'ACCOUNT_DELETED',
    );
    expect(deleteEmailCallIndex).toBe(0); // the very first sendEmail call this method makes
  });

  it('scrubs reasonText on every prior AccountAction for this candidate, including an earlier deactivation, while keeping reasonCategory', async () => {
    const { service, prisma } = makeService({
      profiles: [{ ...BASE_PROFILE }],
      users: [{ id: 'user-1', email: 'ada@example.com', phone: null }],
    });
    await service.deactivate('user-1', { reasonCategory: 'TOO_MANY_EMAILS', reasonText: 'identifying detail' });
    // Deactivate throws on a second call while already deactivated — reset for this test's purposes.
    prisma._entries.length = 0;
    await prisma.candidateProfile.update({ where: { id: 'profile-1' }, data: { deactivatedAt: null } });

    await service.delete('user-1', { confirmation: 'DELETE', reasonCategory: 'PRIVACY_CONCERNS' });

    const deactivateAction = prisma._accountActions.find((a) => a.type === AccountActionType.DEACTIVATED)!;
    expect(deactivateAction.reasonText).toBeNull();
    expect(deactivateAction.reasonCategory).toBe('TOO_MANY_EMAILS'); // category survives
    const deleteAction = prisma._accountActions.find((a) => a.type === AccountActionType.DELETED)!;
    // undefined (never set in the create() call) or null are equally "no
    // reason text stored" — the DELETED row's own reasonText was never
    // written in the first place (see AccountService.delete's own comment
    // on why), as opposed to the DEACTIVATED row above, which was written
    // then explicitly scrubbed back to null by the same transaction.
    expect(deleteAction.reasonText ?? null).toBeNull();
  });

  it('rejects deleting an already-deleted account', async () => {
    const { service } = makeService({ profiles: [{ ...BASE_PROFILE, deletedAt: new Date() }] });
    await expect(service.delete('user-1', { confirmation: 'DELETE' })).rejects.toThrow('already been deleted');
  });
});
