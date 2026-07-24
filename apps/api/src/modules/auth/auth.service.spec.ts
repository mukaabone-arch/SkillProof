import { HttpException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';

type UserRow = { id: string; phone: string | null; email: string | null; role: Role };

/**
 * Minimal in-memory stand-in for PrismaService — just enough of
 * user/refreshToken/$transaction to exercise AuthService's OTP paths
 * without a real database. `users` is shared/mutated across calls within a
 * test so findUnique sees what $transaction's tx.user.create just wrote,
 * same as a real DB would.
 */
function fakePrisma(users: UserRow[] = []) {
  let nextId = 1;

  return {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { phone?: string; email?: string } }) => {
        if (where.phone !== undefined) return users.find((u) => u.phone === where.phone) ?? null;
        if (where.email !== undefined) return users.find((u) => u.email === where.email) ?? null;
        return null;
      }),
      // Plain-candidate signup (verifyOtp's non-employer branch) creates
      // directly via prisma.user.create, not through $transaction — role
      // isn't passed, mirroring the schema's @default(CANDIDATE).
      create: jest.fn(async ({ data }: { data: Partial<UserRow> }) => {
        const user: UserRow = {
          id: `user-${nextId++}`,
          phone: data.phone ?? null,
          email: data.email ?? null,
          role: data.role ?? Role.CANDIDATE,
        };
        users.push(user);
        return user;
      }),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: { data: unknown }) => data),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          create: jest.fn(async ({ data }: { data: Partial<UserRow> & { role: Role } }) => {
            const user: UserRow = {
              id: `user-${nextId++}`,
              phone: data.phone ?? null,
              email: data.email ?? null,
              role: data.role,
            };
            users.push(user);
            return user;
          }),
        },
        organization: {
          create: jest.fn(async ({ data }: { data: { name: string } }) => ({ id: `org-${nextId++}`, ...data })),
        },
        orgMember: {
          create: jest.fn(async ({ data }: { data: unknown }) => ({ id: `member-${nextId++}`, ...(data as object) })),
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

function makeService(users: UserRow[] = []) {
  const prisma = fakePrisma(users);
  const jwt = { signAsync: jest.fn(async () => 'signed.jwt.token') };
  const emailProvider = { send: jest.fn(async (_params: SentEmail): Promise<void> => undefined) };
  const service = new AuthService(
    prisma as never,
    jwt as never,
    {} as never, // GoogleOAuthProvider — unused by the OTP paths under test
    {} as never, // GithubOAuthProvider — ditto
    emailProvider as never,
  );
  return { service, prisma, emailProvider, users };
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
      expect(call.subject).toContain('SkillProof for Employers');
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
