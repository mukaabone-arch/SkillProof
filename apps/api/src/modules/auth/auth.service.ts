import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IdentityProvider, Role, User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GithubOAuthProvider } from './oauth/github-oauth.provider';
import { GoogleOAuthProvider } from './oauth/google-oauth.provider';
import { ExternalProfile, OAuthCodeExchange } from './oauth/oauth.types';
import { normalizeEmail } from './normalize-email';

const EMPLOYER_ROLES: Role[] = [Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER];

const NOT_AN_EMPLOYER_MESSAGE = "This account isn't registered as an employer. Contact your administrator.";

/** NestJS has no built-in 429 exception, so we define one. */
class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

interface OtpEntry {
  otp: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
  sentCount: number;
}

/**
 * OTP auth service with refresh tokens.
 *
 * Token model (spec §4.1):
 *  - Access token: JWT, 15 min, sent as Bearer on every request.
 *  - Refresh token: opaque random string, 30 days, stored HASHED in the DB.
 *    The raw value goes to the client once; we only ever keep its sha256, so a
 *    database leak cannot be replayed. On /auth/refresh we rotate it (old one
 *    revoked, new one issued) — this limits the damage window if one is stolen.
 *
 * DEV MODE: OTPs are logged to console and always "123456". No SMS is sent.
 *
 * PRODUCTION TODO (spec §6.1-B):
 *  1. Move the OTP store from Map to Redis (survives restarts, scales out).
 *  2. Send via MSG91 behind an SmsProvider interface (DLT-registered template).
 *  3. Keep the rate limits below; add IP-based throttling at the gateway.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly otpStore = new Map<string, OtpEntry>();

  private readonly OTP_TTL_MS = 5 * 60 * 1000;
  private readonly RESEND_COOLDOWN_MS = 60 * 1000;
  private readonly MAX_SENDS_PER_WINDOW = 3;
  private readonly MAX_VERIFY_ATTEMPTS = 5;
  private readonly REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly google: GoogleOAuthProvider,
    private readonly github: GithubOAuthProvider,
  ) {}

  async requestOtp(phone: string): Promise<{ message: string }> {
    const now = Date.now();
    const existing = this.otpStore.get(phone);

    if (existing && now - existing.lastSentAt < this.RESEND_COOLDOWN_MS) {
      throw new TooManyRequestsException('Please wait before requesting another OTP.');
    }
    if (existing && existing.sentCount >= this.MAX_SENDS_PER_WINDOW && now < existing.expiresAt) {
      throw new TooManyRequestsException('Too many OTP requests. Try again later.');
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const otp = isDev ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();

    this.otpStore.set(phone, {
      otp,
      expiresAt: now + this.OTP_TTL_MS,
      attempts: 0,
      lastSentAt: now,
      sentCount: (existing?.sentCount ?? 0) + 1,
    });

    if (isDev) {
      this.logger.log(`[DEV] OTP for ${phone}: ${otp}`);
    } else {
      // TODO: await this.smsProvider.sendOtp(phone, otp);
      this.logger.warn('Production OTP send not implemented yet (MSG91 integration pending).');
    }

    return { message: 'OTP sent' };
  }

  /**
   * Shared OTP verification for both the candidate app and the employer
   * portal. Pass `orgName` from the employer registration endpoint only —
   * omitting it is the plain candidate login/signup path.
   *
   * On a brand-new phone: `orgName` present → creates an EMPLOYER_ADMIN user
   * plus an Organization and links them via OrgMember; `orgName` absent →
   * creates a plain CANDIDATE user with an empty profile, as before.
   *
   * On a returning phone: the two flows must not cross — a candidate phone
   * hitting the employer endpoint (or vice versa) gets a clear error instead
   * of silently switching roles.
   */
  async verifyOtp(phone: string, otp: string, orgName?: string) {
    const entry = this.otpStore.get(phone);

    if (!entry || Date.now() > entry.expiresAt) {
      throw new BadRequestException('OTP expired or not requested. Request a new one.');
    }
    if (entry.attempts >= this.MAX_VERIFY_ATTEMPTS) {
      this.otpStore.delete(phone);
      throw new TooManyRequestsException('Too many incorrect attempts. Request a new OTP.');
    }

    entry.attempts += 1;
    if (entry.otp !== otp) {
      throw new BadRequestException('Incorrect OTP.');
    }

    this.otpStore.delete(phone); // single-use

    const isEmployerFlow = !!orgName;
    const existing = await this.prisma.user.findUnique({ where: { phone } });

    if (existing) {
      const isEmployerAccount = EMPLOYER_ROLES.includes(existing.role);
      if (isEmployerFlow && !isEmployerAccount) {
        throw new BadRequestException(
          'This phone number is already registered as a candidate. Log in from the candidate app.',
        );
      }
      if (!isEmployerFlow && isEmployerAccount) {
        throw new BadRequestException(
          'This phone number is registered as an employer. Log in from the employer portal.',
        );
      }

      return this.issueTokens(existing.id, existing.role, {
        id: existing.id,
        phone: existing.phone,
        role: existing.role,
      });
    }

    const user = isEmployerFlow
      ? await this.createEmployer(phone, orgName as string)
      : await this.prisma.user.create({ data: { phone, profile: { create: {} } } });

    return this.issueTokens(user.id, user.role, {
      id: user.id,
      phone: user.phone,
      role: user.role,
    });
  }

  async loginWithGoogle(exchange: OAuthCodeExchange) {
    const profile = await this.google.exchange(exchange);
    return this.loginWithIdentity(IdentityProvider.GOOGLE, profile);
  }

  async loginWithGithub(exchange: OAuthCodeExchange) {
    const profile = await this.github.exchange(exchange);
    return this.loginWithIdentity(IdentityProvider.GITHUB, profile);
  }

  /**
   * Sign-in/sign-up policy shared by every non-phone provider (spec: three
   * equal sign-up paths):
   *
   *  1. (provider, providerId) already has an Identity → log in that User.
   *  2. Otherwise, ONLY if the provider itself attests the email is verified
   *     (Google's email_verified, GitHub's primary+verified email) AND a
   *     User already exists with that email → auto-link a new Identity onto
   *     that existing User.
   *  3. Otherwise (unverified email, or no matching User) → create a new
   *     User + Identity. We never auto-link on an unverified email: that
   *     would let anyone who controls a provider account claiming your email
   *     address (no ownership proof required for an unverified address) walk
   *     straight into your existing account.
   */
  private async loginWithIdentity(provider: IdentityProvider, profile: ExternalProfile) {
    const user = await this.resolveIdentityUser(provider, profile);
    if (user) return this.issueTokens(user.id, user.role, this.publicUser(user));

    const created = await this.createUserWithIdentity(provider, profile);
    return this.issueTokens(created.id, created.role, this.publicUser(created));
  }

  async loginEmployerWithGoogle(exchange: OAuthCodeExchange) {
    const profile = await this.google.exchange(exchange);
    return this.loginEmployerWithIdentity(IdentityProvider.GOOGLE, profile);
  }

  async loginEmployerWithGithub(exchange: OAuthCodeExchange) {
    const profile = await this.github.exchange(exchange);
    return this.loginEmployerWithIdentity(IdentityProvider.GITHUB, profile);
  }

  /**
   * Employer-portal counterpart to loginWithIdentity, mirroring the
   * candidate/employer split in verifyOtp: employer accounts are provisioned
   * manually (an OrgMember row plus an EMPLOYER_ADMIN/EMPLOYER_MEMBER role),
   * never auto-created here. So unlike loginWithIdentity, branch 3 (create a
   * brand-new User) never runs — resolveIdentityUser only *resolves* an
   * existing account (steps 1-2 of the shared policy above), and if that
   * comes back empty, or the resolved account isn't an org member with an
   * employer role, we reject rather than spin up an orphaned candidate
   * account or promote someone in place.
   */
  private async loginEmployerWithIdentity(provider: IdentityProvider, profile: ExternalProfile) {
    const user = await this.resolveIdentityUser(provider, profile);
    if (!user || !EMPLOYER_ROLES.includes(user.role)) {
      throw new ForbiddenException(NOT_AN_EMPLOYER_MESSAGE);
    }

    const orgMember = await this.prisma.orgMember.findUnique({ where: { userId: user.id } });
    if (!orgMember) {
      throw new ForbiddenException(NOT_AN_EMPLOYER_MESSAGE);
    }

    return this.issueTokens(user.id, user.role, this.publicUser(user));
  }

  /** Steps 1-2 of the loginWithIdentity policy above, shared with the employer flow: resolves an existing User by Identity or verified-email auto-link. Returns null if neither matches (candidate flow then creates a new User; employer flow then rejects). */
  private async resolveIdentityUser(provider: IdentityProvider, profile: ExternalProfile): Promise<User | null> {
    const existingIdentity = await this.prisma.identity.findUnique({
      where: { provider_providerId: { provider, providerId: profile.providerId } },
      include: { user: true },
    });
    if (existingIdentity) return existingIdentity.user;

    const linkTarget = await this.findVerifiedEmailMatch(profile);
    if (linkTarget) {
      await this.prisma.identity.create({
        data: {
          userId: linkTarget.id,
          provider,
          providerId: profile.providerId,
          // Raw, as-reported value — see the matching comment in
          // createUserWithIdentity. Not a lookup key, so no normalization.
          email: profile.email,
          emailVerified: profile.emailVerified,
        },
      });
      return linkTarget;
    }

    return null;
  }

  /**
   * Only a provider-verified email is eligible to auto-link; an unverified
   * one is never a lookup key.
   *
   * Case-insensitive on purpose, and deliberately *not* findUnique (which
   * can only do an exact indexed match): normalizing the incoming value
   * alone isn't enough, because existing User.email rows aren't guaranteed
   * to already be lowercased — createUserWithIdentity only started
   * normalizing new writes once this bug was fixed, so any row written
   * before that (or written with different casing by whatever the provider
   * reported at the time) would otherwise silently stop matching again.
   * `mode: 'insensitive'` matches regardless of how the stored value happens
   * to be cased, which is what actually makes this robust.
   */
  private async findVerifiedEmailMatch(profile: ExternalProfile) {
    if (!profile.emailVerified || !profile.email) return null;
    return this.prisma.user.findFirst({
      where: { email: { equals: normalizeEmail(profile.email), mode: 'insensitive' } },
    });
  }

  private async createUserWithIdentity(provider: IdentityProvider, profile: ExternalProfile) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            // Only ever promote a *verified* provider email onto the account
            // record, and normalized (see normalize-email.ts) so it matches
            // whatever a future provider reports for the same mailbox
            // regardless of case — otherwise this becomes exactly the kind
            // of value findVerifiedEmailMatch can never find later. An
            // unverified email lives solely on the Identity row (below) —
            // if it were copied here, it would become a future auto-link
            // target for whoever actually owns that address.
            email: profile.emailVerified && profile.email ? normalizeEmail(profile.email) : null,
            profile: { create: {} },
          },
        });
        await tx.identity.create({
          data: {
            userId: user.id,
            provider,
            providerId: profile.providerId,
            // Deliberately the raw, as-reported value (not normalized) —
            // this is what the provider actually told us at link time, kept
            // for provenance. It's never used as a lookup key, unlike
            // User.email above.
            email: profile.email,
            emailVerified: profile.emailVerified,
          },
        });
        return user;
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err, 'email')) {
        // Lost a race against a concurrent signup/link for the same verified email.
        throw new ConflictException('An account with this email was just created. Please try again.');
      }
      throw err;
    }
  }

  /**
   * Explicit "connect provider" from settings while already logged in.
   * Links unconditionally onto the current user — no email check — since the
   * user is already authenticated and asking for this account by name.
   */
  async connectProvider(userId: string, provider: IdentityProvider, exchange: OAuthCodeExchange) {
    const profile =
      provider === IdentityProvider.GOOGLE
        ? await this.google.exchange(exchange)
        : await this.github.exchange(exchange);

    const existing = await this.prisma.identity.findUnique({
      where: { provider_providerId: { provider, providerId: profile.providerId } },
    });

    if (existing) {
      if (existing.userId === userId) {
        return { ok: true, alreadyConnected: true };
      }
      throw new ConflictException(
        `This ${provider} account is already linked to a different SkillProof account.`,
      );
    }

    await this.prisma.identity.create({
      data: {
        userId,
        provider,
        providerId: profile.providerId,
        email: profile.email,
        emailVerified: profile.emailVerified,
      },
    });
    return { ok: true, alreadyConnected: false };
  }

  private publicUser(user: { id: string; phone: string | null; email: string | null; role: Role }) {
    return { id: user.id, phone: user.phone, email: user.email, role: user.role };
  }

  private isUniqueConstraintError(err: unknown, target: string): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002' &&
      !!(err as { meta?: { target?: string[] } }).meta?.target?.includes(target)
    );
  }

  /**
   * Exchange a valid refresh token for a fresh access token (and a rotated
   * refresh token). Called by the client automatically when a request 401s.
   */
  async refresh(rawRefreshToken: string) {
    if (!rawRefreshToken) throw new UnauthorizedException('Missing refresh token');

    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke the used token, issue a new pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.user.id, stored.user.role);
  }

  /** Revoke a refresh token on logout. */
  async logout(rawRefreshToken: string) {
    if (!rawRefreshToken) return { ok: true };
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken
      .updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
    return { ok: true };
  }

  // ---------- helpers ----------

  /** Creates the User, Organization, and OrgMember link atomically. */
  private async createEmployer(phone: string, orgName: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { phone, role: Role.EMPLOYER_ADMIN } });
      const organization = await tx.organization.create({ data: { name: orgName } });
      await tx.orgMember.create({ data: { userId: user.id, organizationId: organization.id } });
      return user;
    });
  }

  private async issueTokens(userId: string, role: string, user?: unknown) {
    const accessToken = await this.jwt.signAsync({ sub: userId, role });

    const rawRefreshToken = randomBytes(40).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + this.REFRESH_TTL_MS),
      },
    });

    return { accessToken, refreshToken: rawRefreshToken, ...(user ? { user } : {}) };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
