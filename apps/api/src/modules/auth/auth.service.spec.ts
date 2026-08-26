import { HttpException } from '@nestjs/common';
import { OrgInvitationStatus, Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { PRIVACY_VERSION, TERMS_VERSION } from './legal-terms';

type UserRow = { id: string; phone: string | null; email: string | null; role: Role };
type TermsAcceptanceRow = {
  userId: string;
  termsVersion: string;
  privacyVersion: string;
  ageConfirmed: boolean;
  acceptedAt: Date;
};
type OrgMemberRow = { id: string; userId: string; organizationId: string };
type InvitationRow = {
  id: string;
  organizationId: string;
  email: string;
  status: OrgInvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
};

/**
 * Minimal in-memory stand-in for PrismaService — just enough of
 * user/refreshToken/orgMember/orgInvitation/$transaction to exercise
 * AuthService's OTP and invite-accept paths without a real database.
 * `users`/`orgMembers`/`invitations` are shared/mutated across calls within
 * a test so findUnique sees what $transaction's tx.user.create (or a direct
 * write) just wrote, same as a real DB would.
 */
function fakePrisma(
  users: UserRow[] = [],
  orgMembers: OrgMemberRow[] = [],
  invitations: InvitationRow[] = [],
  termsAcceptances: TermsAcceptanceRow[] = [],
) {
  let nextId = 1;

  // Mirrors Prisma's nested-relation write: when a user.create carries
  // `termsAcceptances: { create: {...} }`, the related row is persisted in
  // the same operation. Captured here so tests can assert the acceptance
  // record really is written on every creation path (including inside
  // $transaction and the OAuth path), exactly as a real DB would.
  const captureAcceptance = (
    userId: string,
    data: { termsAcceptances?: { create?: Partial<TermsAcceptanceRow> } },
  ) => {
    const create = data.termsAcceptances?.create;
    if (!create) return;
    termsAcceptances.push({
      userId,
      termsVersion: create.termsVersion as string,
      privacyVersion: create.privacyVersion as string,
      ageConfirmed: create.ageConfirmed ?? true,
      acceptedAt: create.acceptedAt ?? new Date(),
    });
  };

  return {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { phone?: string; email?: string; id?: string } }) => {
        if (where.phone !== undefined) return users.find((u) => u.phone === where.phone) ?? null;
        if (where.email !== undefined) return users.find((u) => u.email === where.email) ?? null;
        if (where.id !== undefined) return users.find((u) => u.id === where.id) ?? null;
        return null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const found = users.find((u) => u.id === where.id);
        if (!found) throw new Error('not found');
        return found;
      }),
      // Verified-email auto-link lookup (findVerifiedEmailMatch). Case-
      // insensitive, matching the real query's `mode: 'insensitive'`.
      findFirst: jest.fn(async ({ where }: { where: { email?: { equals?: string } } }) => {
        const target = where.email?.equals?.toLowerCase();
        if (!target) return null;
        return users.find((u) => u.email?.toLowerCase() === target) ?? null;
      }),
      // Plain-candidate signup (verifyOtp's non-employer branch) creates
      // directly via prisma.user.create, not through $transaction — role
      // isn't passed, mirroring the schema's @default(CANDIDATE).
      create: jest.fn(async ({ data }: { data: Partial<UserRow> & { termsAcceptances?: { create?: Partial<TermsAcceptanceRow> } } }) => {
        const user: UserRow = {
          id: `user-${nextId++}`,
          phone: data.phone ?? null,
          email: data.email ?? null,
          role: data.role ?? Role.CANDIDATE,
        };
        users.push(user);
        captureAcceptance(user.id, data);
        return user;
      }),
      // Used by the add-phone/add-email linking flow to attach an identifier
      // onto an existing row.
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error('not found');
        Object.assign(u, data);
        return u;
      }),
    },
    termsAcceptance: {
      findFirst: jest.fn(async ({ where }: { where: { userId: string } }) => {
        return (
          termsAcceptances
            .filter((t) => t.userId === where.userId)
            .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())[0] ?? null
        );
      }),
    },
    orgMember: {
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) => {
        return orgMembers.find((m) => m.userId === where.userId) ?? null;
      }),
      create: jest.fn(async ({ data }: { data: { userId: string; organizationId: string } }) => {
        const member: OrgMemberRow = { id: `member-${nextId++}`, ...data };
        orgMembers.push(member);
        return member;
      }),
    },
    orgInvitation: {
      findFirst: jest.fn(async ({ where }: { where: { email: string; status: OrgInvitationStatus } }) => {
        return (
          invitations
            .filter((i) => i.email === where.email && i.status === where.status)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
        );
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<InvitationRow> }) => {
        const invitation = invitations.find((i) => i.id === where.id);
        if (!invitation) throw new Error('not found');
        Object.assign(invitation, data);
        return invitation;
      }),
    },
    identity: {
      // No pre-existing identity in these tests — the OAuth paths under test
      // provision brand-new accounts, so (provider, providerId) never resolves.
      findUnique: jest.fn(async () => null),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: { data: unknown }) => data),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        // Backs generateOrgCode's `SELECT nextval('organization_code_seq')` —
        // the exact sequence value doesn't matter to these tests, only that
        // organization.create below receives a `code`.
        $queryRaw: jest.fn(async () => [{ nextval: BigInt(nextId) }]),
        user: {
          create: jest.fn(async ({ data }: { data: Partial<UserRow> & { role?: Role; termsAcceptances?: { create?: Partial<TermsAcceptanceRow> } } }) => {
            const user: UserRow = {
              id: `user-${nextId++}`,
              phone: data.phone ?? null,
              email: data.email ?? null,
              role: data.role ?? Role.CANDIDATE,
            };
            users.push(user);
            captureAcceptance(user.id, data);
            return user;
          }),
        },
        organization: {
          create: jest.fn(async ({ data }: { data: { name: string; code: string } }) => ({ id: `org-${nextId++}`, ...data })),
        },
        orgMember: {
          create: jest.fn(async ({ data }: { data: { userId: string; organizationId: string } }) => {
            const member: OrgMemberRow = { id: `member-${nextId++}`, ...data };
            orgMembers.push(member);
            return member;
          }),
        },
        identity: {
          create: jest.fn(async ({ data }: { data: unknown }) => data),
        },
      };
      return fn(tx);
    }),
  };
}

interface SentEmail {
  to: string;
  subject: string;
  html: string;
}

function makeService(
  users: UserRow[] = [],
  orgMembers: OrgMemberRow[] = [],
  invitations: InvitationRow[] = [],
  oauth: { google?: unknown; github?: unknown } = {},
) {
  const termsAcceptances: TermsAcceptanceRow[] = [];
  const prisma = fakePrisma(users, orgMembers, invitations, termsAcceptances);
  const jwt = { signAsync: jest.fn(async () => 'signed.jwt.token') };
  const emailProvider = { send: jest.fn(async (_params: SentEmail): Promise<void> => undefined) };
  const smsProvider = { sendOtp: jest.fn(async (_params: { to: string; otp: string }): Promise<void> => undefined) };
  const service = new AuthService(
    prisma as never,
    jwt as never,
    (oauth.google ?? {}) as never, // GoogleOAuthProvider — a real stub only for the OAuth tests
    (oauth.github ?? {}) as never, // GithubOAuthProvider — ditto
    emailProvider as never,
    smsProvider as never,
  );
  return { service, prisma, emailProvider, smsProvider, users, orgMembers, invitations, termsAcceptances };
}

/** A PENDING invitation, 7 days out, matching OrgMembersService's own TTL — createdAt staggered slightly into the past so multiple invitations in one test sort deterministically. */
function pendingInvitation(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: `invite-${Math.random().toString(36).slice(2)}`,
    organizationId: 'org-1',
    email: 'invitee@acme.com',
    status: OrgInvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    createdAt: new Date(Date.now() - 1000),
    ...overrides,
  };
}

/** Dev-mode OTP is always this fixed value — see AuthService.issueOtp. */
const DEV_OTP = '123456';

describe('AuthService — employer email OTP', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.useRealTimers();
  });

  describe('requestEmailOtp', () => {
    it('dev mode: logs instead of sending, never calls the email provider', async () => {
      process.env.NODE_ENV = 'test';
      const { service, emailProvider } = makeService();

      await expect(service.requestEmailOtp('new@acme.com')).resolves.toEqual({ message: 'OTP sent' });
      expect(emailProvider.send).not.toHaveBeenCalled();
    });

    it('production: sends a 6-digit code via EMAIL_PROVIDER, addressed to the normalized email', async () => {
      process.env.NODE_ENV = 'production';
      const { service, emailProvider } = makeService();

      await service.requestEmailOtp('Jane@Example.COM');

      expect(emailProvider.send).toHaveBeenCalledTimes(1);
      const call = emailProvider.send.mock.calls[0][0];
      expect(call.to).toBe('jane@example.com');
      expect(call.subject).toContain('MyAmbii for Employers');
      expect(call.html).toMatch(/\b\d{6}\b/);
    });

    it('production: a failed send surfaces as an error, not a silent "OTP sent"', async () => {
      process.env.NODE_ENV = 'production';
      const { service, emailProvider } = makeService();
      emailProvider.send.mockRejectedValueOnce(new Error('Resend outage'));

      await expect(service.requestEmailOtp('new@acme.com')).rejects.toThrow(
        'Could not send the verification code. Please try again.',
      );
    });

    it('cooldown: a second request within 60s is rate-limited', async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await service.requestEmailOtp('new@acme.com');
      await expect(service.requestEmailOtp('new@acme.com')).rejects.toThrow(
        'Please wait before requesting another OTP.',
      );
    });

    it('max sends per window: a 4th request inside the same unexpired OTP blocks even after the cooldown passes', async () => {
      process.env.NODE_ENV = 'test';
      jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
      const { service } = makeService();

      // 3 sends allowed (MAX_SENDS_PER_WINDOW), each past the 60s cooldown.
      await service.requestEmailOtp('new@acme.com');
      jest.advanceTimersByTime(61_000);
      await service.requestEmailOtp('new@acme.com');
      jest.advanceTimersByTime(61_000);
      await service.requestEmailOtp('new@acme.com');
      jest.advanceTimersByTime(61_000);

      await expect(service.requestEmailOtp('new@acme.com')).rejects.toThrow(
        'Too many OTP requests. Try again later.',
      );
    });

    it("phone and email OTP requests don't share rate-limit state", async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await service.requestOtp('+919999999999');
      // Would throw if phone and email requests collided on the same otpStore key.
      await expect(service.requestEmailOtp('new@acme.com')).resolves.toEqual({ message: 'OTP sent' });
    });
  });

  describe('verifyEmailOtp', () => {
    it('brand-new email: creates an EMPLOYER_ADMIN user + Organization + OrgMember, returns tokens', async () => {
      process.env.NODE_ENV = 'test';
      const { service, prisma, users } = makeService();

      await service.requestEmailOtp('new@acme.com');
      const result = await service.verifyEmailOtp('new@acme.com', DEV_OTP, 'Acme Inc.');

      expect(result).toMatchObject({ accessToken: 'signed.jwt.token', refreshToken: expect.any(String) });
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ email: 'new@acme.com', role: Role.EMPLOYER_ADMIN });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('email is normalized/case-insensitive between request and verify', async () => {
      process.env.NODE_ENV = 'test';
      const { service, users } = makeService();

      await service.requestEmailOtp('Jane@Example.COM');
      await service.verifyEmailOtp('jane@example.com', DEV_OTP, 'Acme Inc.');

      expect(users[0].email).toBe('jane@example.com');
    });

    it('wrong code: rejects and does not create a user', async () => {
      process.env.NODE_ENV = 'test';
      const { service, users } = makeService();

      await service.requestEmailOtp('new@acme.com');
      await expect(service.verifyEmailOtp('new@acme.com', '000000', 'Acme Inc.')).rejects.toThrow('Incorrect OTP.');
      expect(users).toHaveLength(0);
    });

    it('too many wrong attempts: locks out before the correct code is ever accepted', async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await service.requestEmailOtp('new@acme.com');
      for (let i = 0; i < 5; i++) {
        await expect(service.verifyEmailOtp('new@acme.com', '000000', 'Acme Inc.')).rejects.toThrow();
      }
      // The 6th attempt — even with the right code — is already locked out (entry deleted).
      await expect(service.verifyEmailOtp('new@acme.com', DEV_OTP, 'Acme Inc.')).rejects.toThrow(
        'Too many incorrect attempts. Request a new OTP.',
      );
    });

    it('returning employer: logs in, does not duplicate the organization, ignores orgName', async () => {
      process.env.NODE_ENV = 'test';
      const existing: UserRow = { id: 'user-1', phone: null, email: 'owner@acme.com', role: Role.EMPLOYER_ADMIN };
      const { service, prisma } = makeService([existing]);

      await service.requestEmailOtp('owner@acme.com');
      const result = await service.verifyEmailOtp('owner@acme.com', DEV_OTP, 'A Different Org Name');

      expect(result).toMatchObject({ accessToken: 'signed.jwt.token' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('an email already registered as a candidate is rejected, not silently promoted', async () => {
      process.env.NODE_ENV = 'test';
      const existing: UserRow = { id: 'user-1', phone: null, email: 'candidate@acme.com', role: Role.CANDIDATE };
      const { service, prisma } = makeService([existing]);

      await service.requestEmailOtp('candidate@acme.com');
      await expect(service.verifyEmailOtp('candidate@acme.com', DEV_OTP, 'Acme Inc.')).rejects.toThrow(
        'This email is already registered as a candidate. Log in from the candidate app.',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('single-use: the same code cannot be verified twice', async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await service.requestEmailOtp('new@acme.com');
      await service.verifyEmailOtp('new@acme.com', DEV_OTP, 'Acme Inc.');
      await expect(service.verifyEmailOtp('new@acme.com', DEV_OTP, 'Acme Inc.')).rejects.toThrow(
        'OTP expired or not requested. Request a new one.',
      );
    });
  });

  describe('company-email domain gate (signup only — see employer-email-domain.spec.ts for the matching rules themselves)', () => {
    it('requestEmailOtp rejects a brand-new signup on a free-provider domain, and never issues a code', async () => {
      process.env.NODE_ENV = 'test';
      const { service, emailProvider } = makeService();

      await expect(service.requestEmailOtp('new@gmail.com')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
      expect(emailProvider.send).not.toHaveBeenCalled();

      // No OTP was ever issued for this email — proven by verify failing on
      // "not requested" rather than "incorrect", even with the correct
      // dev-mode code.
      await expect(service.verifyEmailOtp('new@gmail.com', DEV_OTP, 'Acme Inc.')).rejects.toThrow(
        'OTP expired or not requested. Request a new one.',
      );
    });

    it('requestEmailOtp rejects a brand-new signup on a disposable domain', async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await expect(service.requestEmailOtp('new@mailinator.com')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
    });

    it('requestEmailOtp allows a brand-new signup on an ordinary company domain (regression guard)', async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await expect(service.requestEmailOtp('new@acme.com')).resolves.toEqual({ message: 'OTP sent' });
    });

    it('verifyEmailOtp independently rejects account creation on a free-provider domain, even if an OTP was somehow issued (defense in depth, not just the request-time gate)', async () => {
      process.env.NODE_ENV = 'test';
      // Seed as if this address had an account at request-time (so
      // requestEmailOtp's own `!existing` check doesn't fire) — then remove
      // it before verify, simulating the account being gone by commit time.
      // This isolates verifyEmailOtp's own gate from requestEmailOtp's.
      const placeholder: UserRow = { id: 'temp-1', phone: null, email: 'racy@gmail.com', role: Role.EMPLOYER_ADMIN };
      const { service, users, prisma } = makeService([placeholder]);

      await service.requestEmailOtp('racy@gmail.com');
      users.length = 0; // the account is gone by the time verify runs

      await expect(service.verifyEmailOtp('racy@gmail.com', DEV_OTP, 'Acme Inc.')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('grandfathering — an existing free-provider employer account keeps working', () => {
      it('can still request an OTP (login), matching the real mukaabone@gmail.com account this was checked against', async () => {
        process.env.NODE_ENV = 'test';
        const existing: UserRow = { id: 'user-1', phone: null, email: 'mukaabone@gmail.com', role: Role.EMPLOYER_ADMIN };
        const { service } = makeService([existing]);

        await expect(service.requestEmailOtp('mukaabone@gmail.com')).resolves.toEqual({ message: 'OTP sent' });
      });

      it('can still verify and log in — no COMPANY_EMAIL_REQUIRED, no new account, orgName ignored', async () => {
        process.env.NODE_ENV = 'test';
        const existing: UserRow = { id: 'user-1', phone: null, email: 'mukaabone@gmail.com', role: Role.EMPLOYER_ADMIN };
        const { service, prisma, users } = makeService([existing]);

        await service.requestEmailOtp('mukaabone@gmail.com');
        const result = await service.verifyEmailOtp('mukaabone@gmail.com', DEV_OTP, 'Some Other Org');

        expect(result).toMatchObject({ accessToken: 'signed.jwt.token', refreshToken: expect.any(String) });
        expect(users).toHaveLength(1); // no duplicate/new account
        expect(prisma.$transaction).not.toHaveBeenCalled(); // never re-entered createEmployer
      });
    });

    it("acceptInvite is NOT gated — an admin's invite to a personal address (e.g. a contractor) overrides the restriction", async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'contractor@gmail.com', organizationId: 'org-1' });
      const { service, users, orgMembers } = makeService([], [], [invitation]);

      await service.requestInviteOtp('contractor@gmail.com');
      const result = await service.acceptInvite('contractor@gmail.com', DEV_OTP);

      expect(result).toMatchObject({ accessToken: 'signed.jwt.token' });
      expect(users[0]).toMatchObject({ email: 'contractor@gmail.com', role: Role.EMPLOYER_MEMBER });
      expect(orgMembers[0]).toMatchObject({ userId: users[0].id, organizationId: 'org-1' });
    });
  });

  describe('phone paths are unaffected', () => {
    it('phone signup still works exactly as before (regression guard on the issueOtp/consumeOtp extraction)', async () => {
      process.env.NODE_ENV = 'test';
      const { service, users } = makeService();

      await service.requestOtp('+919999999999');
      const result = await service.verifyOtp('+919999999999', DEV_OTP, 'Acme Inc.');

      expect(result).toMatchObject({ accessToken: 'signed.jwt.token' });
      expect(users[0]).toMatchObject({ phone: '+919999999999', role: Role.EMPLOYER_ADMIN });
    });

    it('phone candidate signup (no orgName) still creates a plain CANDIDATE', async () => {
      process.env.NODE_ENV = 'test';
      const { service, users } = makeService();

      await service.requestOtp('+919999999998');
      await service.verifyOtp('+919999999998', DEV_OTP);

      expect(users[0]).toMatchObject({ phone: '+919999999998', role: Role.CANDIDATE });
    });
  });

  it('sanity: rate-limit exceptions are 429s', async () => {
    process.env.NODE_ENV = 'test';
    const { service } = makeService();

    await service.requestEmailOtp('new@acme.com');
    try {
      await service.requestEmailOtp('new@acme.com');
      throw new Error('expected requestEmailOtp to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });
});

describe('AuthService — candidate email OTP', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.useRealTimers();
  });

  describe('requestCandidateEmailOtp', () => {
    it('dev mode: logs instead of sending, never calls the email provider', async () => {
      process.env.NODE_ENV = 'test';
      const { service, emailProvider } = makeService();

      await expect(service.requestCandidateEmailOtp('new@candidate.com')).resolves.toEqual({ message: 'OTP sent' });
      expect(emailProvider.send).not.toHaveBeenCalled();
    });

    it('production: sends a 6-digit code via EMAIL_PROVIDER, addressed to the normalized email, with candidate-specific copy', async () => {
      process.env.NODE_ENV = 'production';
      const { service, emailProvider } = makeService();

      await service.requestCandidateEmailOtp('Jane@Example.COM');

      expect(emailProvider.send).toHaveBeenCalledTimes(1);
      const call = emailProvider.send.mock.calls[0][0];
      expect(call.to).toBe('jane@example.com');
      expect(call.subject).toBe('Your MyAmbii verification code');
      // Distinct from the employer copy ("MyAmbii for Employers") — this
      // is what a first-time candidate reads.
      expect(call.subject).not.toContain('Employers');
      expect(call.html).not.toContain('Employers');
      expect(call.html).toMatch(/\b\d{6}\b/);
    });

    it('production: a failed send surfaces as an error, not a silent "OTP sent"', async () => {
      process.env.NODE_ENV = 'production';
      const { service, emailProvider } = makeService();
      emailProvider.send.mockRejectedValueOnce(new Error('Resend outage'));

      await expect(service.requestCandidateEmailOtp('new@candidate.com')).rejects.toThrow(
        'Could not send the verification code. Please try again.',
      );
    });

    it('cooldown: a second request within 60s is rate-limited', async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await service.requestCandidateEmailOtp('new@candidate.com');
      await expect(service.requestCandidateEmailOtp('new@candidate.com')).rejects.toThrow(
        'Please wait before requesting another OTP.',
      );
    });

    it('max sends per window: a 4th request inside the same unexpired OTP blocks even after the cooldown passes', async () => {
      process.env.NODE_ENV = 'test';
      jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
      const { service } = makeService();

      await service.requestCandidateEmailOtp('new@candidate.com');
      jest.advanceTimersByTime(61_000);
      await service.requestCandidateEmailOtp('new@candidate.com');
      jest.advanceTimersByTime(61_000);
      await service.requestCandidateEmailOtp('new@candidate.com');
      jest.advanceTimersByTime(61_000);

      await expect(service.requestCandidateEmailOtp('new@candidate.com')).rejects.toThrow(
        'Too many OTP requests. Try again later.',
      );
    });
  });

  describe('verifyCandidateEmailOtp', () => {
    it('brand-new email: creates a plain CANDIDATE with a profile shell, returns tokens', async () => {
      process.env.NODE_ENV = 'test';
      const { service, prisma, users } = makeService();

      await service.requestCandidateEmailOtp('new@candidate.com');
      const result = await service.verifyCandidateEmailOtp('new@candidate.com', DEV_OTP);

      expect(result).toMatchObject({ accessToken: 'signed.jwt.token', refreshToken: expect.any(String) });
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ email: 'new@candidate.com', role: Role.CANDIDATE });
      // Provisioned via the plain prisma.user.create path (matching the
      // phone candidate branch exactly), never the org-creating transaction —
      // and with the acceptance record nested into that same create.
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'new@candidate.com',
          profile: { create: {} },
          termsAcceptances: { create: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, ageConfirmed: true } },
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('email is normalized/case-insensitive between request and verify', async () => {
      process.env.NODE_ENV = 'test';
      const { service, users } = makeService();

      await service.requestCandidateEmailOtp('Jane@Example.COM');
      await service.verifyCandidateEmailOtp('jane@example.com', DEV_OTP);

      expect(users[0].email).toBe('jane@example.com');
    });

    it('wrong code: rejects and does not create a user', async () => {
      process.env.NODE_ENV = 'test';
      const { service, users } = makeService();

      await service.requestCandidateEmailOtp('new@candidate.com');
      await expect(service.verifyCandidateEmailOtp('new@candidate.com', '000000')).rejects.toThrow('Incorrect OTP.');
      expect(users).toHaveLength(0);
    });

    it('too many wrong attempts: locks out before the correct code is ever accepted', async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await service.requestCandidateEmailOtp('new@candidate.com');
      for (let i = 0; i < 5; i++) {
        await expect(service.verifyCandidateEmailOtp('new@candidate.com', '000000')).rejects.toThrow();
      }
      await expect(service.verifyCandidateEmailOtp('new@candidate.com', DEV_OTP)).rejects.toThrow(
        'Too many incorrect attempts. Request a new OTP.',
      );
    });

    it('returning candidate: logs in, does not create a second profile/user', async () => {
      process.env.NODE_ENV = 'test';
      const existing: UserRow = { id: 'user-1', phone: null, email: 'returning@candidate.com', role: Role.CANDIDATE };
      const { service, prisma, users } = makeService([existing]);

      await service.requestCandidateEmailOtp('returning@candidate.com');
      const result = await service.verifyCandidateEmailOtp('returning@candidate.com', DEV_OTP);

      expect(result).toMatchObject({ accessToken: 'signed.jwt.token' });
      expect(users).toHaveLength(1); // no duplicate created
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('single-use: the same code cannot be verified twice', async () => {
      process.env.NODE_ENV = 'test';
      const { service } = makeService();

      await service.requestCandidateEmailOtp('new@candidate.com');
      await service.verifyCandidateEmailOtp('new@candidate.com', DEV_OTP);
      await expect(service.verifyCandidateEmailOtp('new@candidate.com', DEV_OTP)).rejects.toThrow(
        'OTP expired or not requested. Request a new one.',
      );
    });
  });

  describe('role separation from the employer email path', () => {
    it('an email already registered as an employer is rejected here, not silently logged in as a candidate', async () => {
      process.env.NODE_ENV = 'test';
      const existingEmployer: UserRow = { id: 'user-1', phone: null, email: 'owner@acme.com', role: Role.EMPLOYER_ADMIN };
      const { service, prisma } = makeService([existingEmployer]);

      await service.requestCandidateEmailOtp('owner@acme.com');
      await expect(service.verifyCandidateEmailOtp('owner@acme.com', DEV_OTP)).rejects.toThrow(
        'This email is already registered as an employer. Log in from the employer portal.',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a brand-new candidate signup never creates an Organization', async () => {
      process.env.NODE_ENV = 'test';
      const { service, prisma } = makeService();

      await service.requestCandidateEmailOtp('new@candidate.com');
      await service.verifyCandidateEmailOtp('new@candidate.com', DEV_OTP);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('the reverse guard still holds: an email registered as a candidate is rejected by the employer verify path', async () => {
      process.env.NODE_ENV = 'test';
      const existingCandidate: UserRow = { id: 'user-1', phone: null, email: 'candidate@acme.com', role: Role.CANDIDATE };
      const { service } = makeService([existingCandidate]);

      await service.requestEmailOtp('candidate@acme.com');
      await expect(service.verifyEmailOtp('candidate@acme.com', DEV_OTP, 'Acme Inc.')).rejects.toThrow(
        'This email is already registered as a candidate. Log in from the candidate app.',
      );
    });
  });
});

describe('AuthService — team-invite acceptance', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('requestInviteOtp', () => {
    it('no pending invitation for this email: rejects rather than issuing a code', async () => {
      process.env.NODE_ENV = 'test';
      const { service, emailProvider } = makeService();

      await expect(service.requestInviteOtp('nobody@acme.com')).rejects.toThrow(
        'No pending invitation was found for this email.',
      );
      expect(emailProvider.send).not.toHaveBeenCalled();
    });

    it('a pending invitation exists: dev mode logs instead of sending', async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'invitee@acme.com' });
      const { service, emailProvider } = makeService([], [], [invitation]);

      await expect(service.requestInviteOtp('invitee@acme.com')).resolves.toEqual({ message: 'OTP sent' });
      expect(emailProvider.send).not.toHaveBeenCalled();
    });

    it("doesn't share rate-limit/otp state with the plain employer-signup email OTP for the same address", async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'dual@acme.com' });
      const { service } = makeService([], [], [invitation]);

      // Would throw (cooldown) if requestEmailOtp and requestInviteOtp collided on the same otpStore key.
      await service.requestEmailOtp('dual@acme.com');
      await expect(service.requestInviteOtp('dual@acme.com')).resolves.toEqual({ message: 'OTP sent' });
    });

    it('an expired invitation is treated as if none exists, and is flipped to EXPIRED', async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'late@acme.com', expiresAt: new Date(Date.now() - 1000) });
      const { service, invitations } = makeService([], [], [invitation]);

      await expect(service.requestInviteOtp('late@acme.com')).rejects.toThrow(
        'No pending invitation was found for this email.',
      );
      expect(invitations[0].status).toBe(OrgInvitationStatus.EXPIRED);
    });
  });

  describe('acceptInvite', () => {
    it('brand-new email: creates an EMPLOYER_MEMBER (not ADMIN) linked to the inviting org, marks the invitation ACCEPTED', async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'invitee@acme.com', organizationId: 'org-1' });
      const { service, users, orgMembers, invitations } = makeService([], [], [invitation]);

      await service.requestInviteOtp('invitee@acme.com');
      const result = await service.acceptInvite('invitee@acme.com', DEV_OTP);

      expect(result).toMatchObject({ accessToken: 'signed.jwt.token', refreshToken: expect.any(String) });
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ email: 'invitee@acme.com', role: Role.EMPLOYER_MEMBER });
      expect(orgMembers).toHaveLength(1);
      expect(orgMembers[0]).toMatchObject({ userId: users[0].id, organizationId: 'org-1' });
      expect(invitations[0].status).toBe(OrgInvitationStatus.ACCEPTED);
      expect(invitations[0].acceptedAt).not.toBeNull();
    });

    it('never provisions an admin — only OrgMembersService.promote can create one', async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'invitee@acme.com' });
      const { service, users } = makeService([], [], [invitation]);

      await service.requestInviteOtp('invitee@acme.com');
      await service.acceptInvite('invitee@acme.com', DEV_OTP);

      expect(users[0].role).not.toBe(Role.EMPLOYER_ADMIN);
    });

    it('an email already registered as a candidate is rejected, not silently converted to an employer', async () => {
      process.env.NODE_ENV = 'test';
      const existingCandidate: UserRow = { id: 'user-1', phone: null, email: 'candidate@acme.com', role: Role.CANDIDATE };
      const invitation = pendingInvitation({ email: 'candidate@acme.com' });
      const { service, orgMembers } = makeService([existingCandidate], [], [invitation]);

      await service.requestInviteOtp('candidate@acme.com');
      await expect(service.acceptInvite('candidate@acme.com', DEV_OTP)).rejects.toThrow(
        'This email is already registered as a candidate account.',
      );
      expect(orgMembers).toHaveLength(0);
    });

    it('an existing employer who already belongs to an organization is rejected — one user, one org', async () => {
      process.env.NODE_ENV = 'test';
      const existingEmployer: UserRow = { id: 'user-1', phone: null, email: 'busy@other.com', role: Role.EMPLOYER_MEMBER };
      const existingMembership: OrgMemberRow = { id: 'member-1', userId: 'user-1', organizationId: 'org-other' };
      const invitation = pendingInvitation({ email: 'busy@other.com', organizationId: 'org-1' });
      const { service, orgMembers } = makeService([existingEmployer], [existingMembership], [invitation]);

      await service.requestInviteOtp('busy@other.com');
      await expect(service.acceptInvite('busy@other.com', DEV_OTP)).rejects.toThrow(
        'This email already belongs to an organization.',
      );
      // Unchanged — still only the one pre-existing membership, never a second row for the same user.
      expect(orgMembers).toHaveLength(1);
    });

    it('wrong code: rejects and never creates a user or touches the invitation', async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'invitee@acme.com' });
      const { service, users, invitations } = makeService([], [], [invitation]);

      await service.requestInviteOtp('invitee@acme.com');
      await expect(service.acceptInvite('invitee@acme.com', '000000')).rejects.toThrow('Incorrect OTP.');

      expect(users).toHaveLength(0);
      expect(invitations[0].status).toBe(OrgInvitationStatus.PENDING);
    });

    it('email is normalized/case-insensitive between the invitation, request, and verify', async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'jane@example.com' });
      const { service, users } = makeService([], [], [invitation]);

      await service.requestInviteOtp('Jane@Example.COM');
      await service.acceptInvite('Jane@Example.COM', DEV_OTP);

      expect(users[0].email).toBe('jane@example.com');
    });

    it('single-use: the same code cannot be verified twice', async () => {
      process.env.NODE_ENV = 'test';
      const invitation = pendingInvitation({ email: 'invitee@acme.com' });
      const { service } = makeService([], [], [invitation]);

      await service.requestInviteOtp('invitee@acme.com');
      await service.acceptInvite('invitee@acme.com', DEV_OTP);
      await expect(service.acceptInvite('invitee@acme.com', DEV_OTP)).rejects.toThrow(
        'OTP expired or not requested. Request a new one.',
      );
    });
  });
});

describe('AuthService — terms/privacy acceptance is recorded on every creation path', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  /** The shape every path must produce: user pinned, both versions in force, 18+ confirmed. */
  function expectAcceptanceFor(termsAcceptances: TermsAcceptanceRow[], userId: string) {
    const rows = termsAcceptances.filter((t) => t.userId === userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      ageConfirmed: true,
    });
  }

  it('candidate phone OTP signup writes an acceptance record', async () => {
    process.env.NODE_ENV = 'test';
    const { service, users, termsAcceptances } = makeService();

    await service.requestOtp('+919999900001');
    await service.verifyOtp('+919999900001', DEV_OTP);

    expectAcceptanceFor(termsAcceptances, users[0].id);
  });

  it('candidate email OTP signup writes an acceptance record', async () => {
    process.env.NODE_ENV = 'test';
    const { service, users, termsAcceptances } = makeService();

    await service.requestCandidateEmailOtp('new@candidate.com');
    await service.verifyCandidateEmailOtp('new@candidate.com', DEV_OTP);

    expectAcceptanceFor(termsAcceptances, users[0].id);
  });

  it('employer email OTP signup writes an acceptance record (nested in the org-creating transaction)', async () => {
    process.env.NODE_ENV = 'test';
    const { service, users, termsAcceptances } = makeService();

    await service.requestEmailOtp('new@acme.com');
    await service.verifyEmailOtp('new@acme.com', DEV_OTP, 'Acme Inc.');

    expectAcceptanceFor(termsAcceptances, users[0].id);
  });

  it('employer phone OTP signup writes an acceptance record', async () => {
    process.env.NODE_ENV = 'test';
    const { service, users, termsAcceptances } = makeService();

    await service.requestOtp('+919999900002');
    await service.verifyOtp('+919999900002', DEV_OTP, 'Acme Inc.');

    expectAcceptanceFor(termsAcceptances, users[0].id);
  });

  it('team-invite acceptance (brand-new member) writes an acceptance record', async () => {
    process.env.NODE_ENV = 'test';
    const invitation = pendingInvitation({ email: 'invitee@acme.com' });
    const { service, users, termsAcceptances } = makeService([], [], [invitation]);

    await service.requestInviteOtp('invitee@acme.com');
    await service.acceptInvite('invitee@acme.com', DEV_OTP);

    expectAcceptanceFor(termsAcceptances, users[0].id);
  });

  it('OAuth self-provisioning (the path that never shows a signup card) writes an acceptance record', async () => {
    process.env.NODE_ENV = 'test';
    // Provider-verified email, but no existing user/identity → createUserWithIdentity.
    const profile = { providerId: 'google-sub-123', email: 'oauth@candidate.com', emailVerified: true };
    const google = { exchange: jest.fn(async () => profile) };
    const { service, users, termsAcceptances } = makeService([], [], [], { google });

    await service.loginWithGoogle({ code: 'auth-code', redirectUri: 'https://app/cb' });

    expect(users).toHaveLength(1);
    expectAcceptanceFor(termsAcceptances, users[0].id);
  });

  it('the recorded acceptance is retrievable per user via getTermsAcceptance', async () => {
    process.env.NODE_ENV = 'test';
    const { service, users } = makeService();

    await service.requestCandidateEmailOtp('retrieve@candidate.com');
    await service.verifyCandidateEmailOtp('retrieve@candidate.com', DEV_OTP);

    const record = await service.getTermsAcceptance(users[0].id);
    expect(record).toMatchObject({
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      ageConfirmed: true,
    });
  });

  it('getTermsAcceptance returns null for a pre-existing account never given a record (no backfill)', async () => {
    process.env.NODE_ENV = 'test';
    const existing: UserRow = { id: 'legacy-1', phone: null, email: 'legacy@candidate.com', role: Role.CANDIDATE };
    const { service } = makeService([existing]);

    expect(await service.getTermsAcceptance('legacy-1')).toBeNull();
  });

  it('a returning user logging in does NOT write a second acceptance record', async () => {
    process.env.NODE_ENV = 'test';
    const existing: UserRow = { id: 'user-1', phone: null, email: 'returning@candidate.com', role: Role.CANDIDATE };
    const { service, termsAcceptances } = makeService([existing]);

    await service.requestCandidateEmailOtp('returning@candidate.com');
    await service.verifyCandidateEmailOtp('returning@candidate.com', DEV_OTP);

    expect(termsAcceptances).toHaveLength(0);
  });

  it('an existing employer accepting an invite (linked, not created) does NOT write an acceptance record', async () => {
    process.env.NODE_ENV = 'test';
    // Employer-role user with no OrgMember yet — the defensive link branch in acceptInvite.
    const existing: UserRow = { id: 'user-1', phone: null, email: 'member@acme.com', role: Role.EMPLOYER_MEMBER };
    const invitation = pendingInvitation({ email: 'member@acme.com', organizationId: 'org-1' });
    const { service, termsAcceptances } = makeService([existing], [], [invitation]);

    await service.requestInviteOtp('member@acme.com');
    await service.acceptInvite('member@acme.com', DEV_OTP);

    expect(termsAcceptances).toHaveLength(0);
  });
});

describe('AuthService — phone OTP SMS delivery (MSG91 seam)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('dev mode: logs the code instead of sending, never calls the SMS provider', async () => {
    process.env.NODE_ENV = 'test';
    const { service, smsProvider } = makeService();

    await expect(service.requestOtp('+919999900007')).resolves.toEqual({ message: 'OTP sent' });
    expect(smsProvider.sendOtp).not.toHaveBeenCalled();
  });

  it('production: sends the code via the SMS provider, addressed to the phone', async () => {
    process.env.NODE_ENV = 'production';
    const { service, smsProvider } = makeService();

    await service.requestOtp('+919999900007');

    expect(smsProvider.sendOtp).toHaveBeenCalledTimes(1);
    const arg = smsProvider.sendOtp.mock.calls[0][0];
    expect(arg.to).toBe('+919999900007');
    expect(arg.otp).toMatch(/^\d{6}$/);
  });

  it('production: a failed send surfaces as an error, not a silent "OTP sent"', async () => {
    process.env.NODE_ENV = 'production';
    const { service, smsProvider } = makeService();
    smsProvider.sendOtp.mockRejectedValueOnce(new Error('MSG91 send failed'));

    await expect(service.requestOtp('+919999900007')).rejects.toThrow(
      'Could not send the verification code. Please try again.',
    );
  });

  it('phone and email OTP delivery stay on separate channels (SMS request never emails)', async () => {
    process.env.NODE_ENV = 'production';
    const { service, smsProvider, emailProvider } = makeService();

    await service.requestOtp('+919999900008');

    expect(smsProvider.sendOtp).toHaveBeenCalledTimes(1);
    expect(emailProvider.send).not.toHaveBeenCalled();
  });
});

describe('AuthService — add-identifier linking (phone/email onto one account)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('links a phone onto an email-first account — same row, no second account', async () => {
    process.env.NODE_ENV = 'test';
    const me: UserRow = { id: 'user-1', phone: null, email: 'me@candidate.com', role: Role.CANDIDATE };
    const { service, smsProvider, users } = makeService([me]);

    await service.requestLinkPhoneOtp('user-1', '+919999900011');
    expect(smsProvider.sendOtp).not.toHaveBeenCalled(); // dev logs, never sends
    const result = await service.verifyLinkPhoneOtp('user-1', '+919999900011', DEV_OTP);

    expect(result).toMatchObject({ ok: true, phone: '+919999900011' });
    expect(users).toHaveLength(1); // no new account
    expect(users[0]).toMatchObject({ id: 'user-1', email: 'me@candidate.com', phone: '+919999900011' });
  });

  it('links an email onto a phone-first account — same row', async () => {
    process.env.NODE_ENV = 'test';
    const me: UserRow = { id: 'user-1', phone: '+919999900012', email: null, role: Role.CANDIDATE };
    const { service, users } = makeService([me]);

    await service.requestLinkEmailOtp('user-1', 'New@Candidate.com');
    const result = await service.verifyLinkEmailOtp('user-1', 'new@candidate.com', DEV_OTP);

    expect(result).toMatchObject({ ok: true, email: 'new@candidate.com' });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 'user-1', phone: '+919999900012', email: 'new@candidate.com' });
  });

  it('rejects linking a phone that already belongs to another account — with a non-leaky message, and no OTP sent', async () => {
    process.env.NODE_ENV = 'test';
    const me: UserRow = { id: 'user-1', phone: null, email: 'me@candidate.com', role: Role.CANDIDATE };
    const other: UserRow = { id: 'user-2', phone: '+919999900013', email: null, role: Role.CANDIDATE };
    const { service, smsProvider } = makeService([me, other]);

    // The message must NOT confirm the number already has an account (no
    // enumeration oracle) — it reads like a typo/ineligible-value hint instead.
    await expect(service.requestLinkPhoneOtp('user-1', '+919999900013')).rejects.toThrow(
      "This phone number can't be added to your account. Double-check it and try again.",
    );
    await expect(service.requestLinkPhoneOtp('user-1', '+919999900013')).rejects.not.toThrow(/another|in use|already/i);
    expect(smsProvider.sendOtp).not.toHaveBeenCalled(); // refused before any send
  });

  it('rejects linking an email that already belongs to another account — with a non-leaky message', async () => {
    process.env.NODE_ENV = 'test';
    const me: UserRow = { id: 'user-1', phone: '+919999900021', email: null, role: Role.CANDIDATE };
    const other: UserRow = { id: 'user-2', phone: null, email: 'taken@candidate.com', role: Role.CANDIDATE };
    const { service } = makeService([me, other]);

    // Case-insensitive match still hits (assertEmailLinkable), and the copy stays vague.
    await expect(service.requestLinkEmailOtp('user-1', 'Taken@Candidate.com')).rejects.toThrow(
      "This email address can't be added to your account. Double-check it and try again.",
    );
    await expect(service.requestLinkEmailOtp('user-1', 'Taken@Candidate.com')).rejects.not.toThrow(/another|in use|already/i);
  });

  it('rejects linking a phone when the account already has one', async () => {
    process.env.NODE_ENV = 'test';
    const me: UserRow = { id: 'user-1', phone: '+919999900014', email: 'me@candidate.com', role: Role.CANDIDATE };
    const { service } = makeService([me]);

    await expect(service.requestLinkPhoneOtp('user-1', '+919999900099')).rejects.toThrow(
      'Your account already has a phone number.',
    );
  });

  it('a wrong link-OTP does not attach the phone', async () => {
    process.env.NODE_ENV = 'test';
    const me: UserRow = { id: 'user-1', phone: null, email: 'me@candidate.com', role: Role.CANDIDATE };
    const { service, users } = makeService([me]);

    await service.requestLinkPhoneOtp('user-1', '+919999900015');
    await expect(service.verifyLinkPhoneOtp('user-1', '+919999900015', '000000')).rejects.toThrow('Incorrect OTP.');
    expect(users[0].phone).toBeNull();
  });

  it('a link-phone OTP is namespaced apart from a login OTP for the same number', async () => {
    process.env.NODE_ENV = 'test';
    const me: UserRow = { id: 'user-1', phone: null, email: 'me@candidate.com', role: Role.CANDIDATE };
    const { service } = makeService([me]);

    // Would throw (cooldown) if link and login shared the same otpStore key.
    await service.requestOtp('+919999900016');
    await expect(service.requestLinkPhoneOtp('user-1', '+919999900016')).resolves.toEqual({ message: 'OTP sent' });
  });

  describe('company-email domain gate on link-email (employer-only, closes the phone-first bypass)', () => {
    it('an employer cannot link a free-provider email onto their account', async () => {
      process.env.NODE_ENV = 'test';
      const me: UserRow = { id: 'user-1', phone: '+919999900030', email: null, role: Role.EMPLOYER_ADMIN };
      const { service, users } = makeService([me]);

      await expect(service.requestLinkEmailOtp('user-1', 'personal@gmail.com')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
      expect(users[0].email).toBeNull(); // unchanged
    });

    it('an employer cannot link a disposable email either', async () => {
      process.env.NODE_ENV = 'test';
      const me: UserRow = { id: 'user-1', phone: '+919999900031', email: null, role: Role.EMPLOYER_ADMIN };
      const { service } = makeService([me]);

      await expect(service.requestLinkEmailOtp('user-1', 'temp@mailinator.com')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
    });

    it('an employer CAN link a company-domain email', async () => {
      process.env.NODE_ENV = 'test';
      const me: UserRow = { id: 'user-1', phone: '+919999900032', email: null, role: Role.EMPLOYER_ADMIN };
      const { service, users } = makeService([me]);

      await service.requestLinkEmailOtp('user-1', 'me@acme.com');
      const result = await service.verifyLinkEmailOtp('user-1', 'me@acme.com', DEV_OTP);

      expect(result).toMatchObject({ ok: true, email: 'me@acme.com' });
      expect(users[0].email).toBe('me@acme.com');
    });

    it('an EMPLOYER_MEMBER (not just EMPLOYER_ADMIN) is gated the same way', async () => {
      process.env.NODE_ENV = 'test';
      const me: UserRow = { id: 'user-1', phone: '+919999900033', email: null, role: Role.EMPLOYER_MEMBER };
      const { service } = makeService([me]);

      await expect(service.requestLinkEmailOtp('user-1', 'personal@yahoo.com')).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
    });

    it('a candidate is completely unaffected — can freely link a free-provider email', async () => {
      process.env.NODE_ENV = 'test';
      const me: UserRow = { id: 'user-1', phone: '+919999900034', email: null, role: Role.CANDIDATE };
      const { service, users } = makeService([me]);

      await service.requestLinkEmailOtp('user-1', 'me@gmail.com');
      const result = await service.verifyLinkEmailOtp('user-1', 'me@gmail.com', DEV_OTP);

      expect(result).toMatchObject({ ok: true, email: 'me@gmail.com' });
      expect(users[0].email).toBe('me@gmail.com');
    });

    it('verifyLinkEmailOtp re-checks at commit too, not just requestLinkEmailOtp — a role change between the two catches it', async () => {
      process.env.NODE_ENV = 'test';
      // A CANDIDATE at request time: the gate is skipped, so requesting an
      // OTP for a free-provider email succeeds normally.
      const me: UserRow = { id: 'user-1', phone: '+919999900035', email: null, role: Role.CANDIDATE };
      const { service, users } = makeService([me]);

      await expect(service.requestLinkEmailOtp('user-1', 'me@gmail.com')).resolves.toEqual({ message: 'OTP sent' });

      // Promoted to an employer role before verify runs (e.g. via
      // OrgMembersService, concurrently) — verify must catch this itself
      // rather than trusting that request-time already cleared it.
      me.role = Role.EMPLOYER_ADMIN;

      await expect(service.verifyLinkEmailOtp('user-1', 'me@gmail.com', DEV_OTP)).rejects.toMatchObject({
        response: { code: 'COMPANY_EMAIL_REQUIRED' },
      });
      expect(users[0].email).toBeNull(); // never attached
    });
  });
});
