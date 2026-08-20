import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IdentityProvider, OrgInvitationStatus, Role, User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_PROVIDER, EmailProvider } from '../notifications/email-provider.interface';
import { SMS_PROVIDER, SmsProvider } from '../notifications/sms-provider.interface';
import { GithubOAuthProvider } from './oauth/github-oauth.provider';
import { GoogleOAuthProvider } from './oauth/google-oauth.provider';
import { ExternalProfile, OAuthCodeExchange } from './oauth/oauth.types';
import { normalizeEmail } from './normalize-email';
import { assertCompanyEmail } from './employer-email-domain';
import { PRIVACY_VERSION, TERMS_VERSION } from './legal-terms';

const EMPLOYER_ROLES: Role[] = [Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER];

const NOT_AN_EMPLOYER_MESSAGE = "This account isn't registered as an employer. Contact your administrator.";

/**
 * Deliberately vague — the add-identifier flow must never confirm whether a
 * phone/email already belongs to *some other* account. A message like "already
 * in use" would turn the authenticated link endpoint into an enumeration
 * oracle: a logged-in attacker could probe numbers/addresses and read back
 * which ones have a MyAmbii account. This copy instead reads like a typo /
 * ineligible-value hint, and is returned identically at both the request-time
 * guard (assert*Linkable) and the commit-time unique-constraint race, so those
 * two paths can't be distinguished from each other either.
 *
 * Residual, accepted on purpose: refusing is still observably different from
 * the "OTP sent" success path, so a determined attacker can still infer *that*
 * a value is taken (just not from the wording). We keep refusing anyway — the
 * only way to erase that difference is to always send the code, which would let
 * this same endpoint be abused to spam SMS/email to arbitrary third parties.
 * The "your account already has a phone/email" case below is a separate message
 * because it's about the caller's *own* account and leaks nothing.
 */
const PHONE_NOT_LINKABLE_MESSAGE =
  "This phone number can't be added to your account. Double-check it and try again.";
const EMAIL_NOT_LINKABLE_MESSAGE =
  "This email address can't be added to your account. Double-check it and try again.";

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
 * DEV MODE: OTPs (phone and email) are logged to console and always
 * "123456". No SMS or email is sent — see requestOtp/requestEmailOtp.
 *
 * PRODUCTION TODO (spec §6.1-B):
 *  1. Move the OTP store from Map to Redis (survives restarts, scales out).
 *  2. Phone: send via MSG91 behind an SmsProvider interface (DLT-registered
 *     template) — still unimplemented, see requestOtp.
 *  3. Keep the rate limits below; add IP-based throttling at the gateway.
 *
 * Email OTP (employer signup only, see requestEmailOtp/verifyEmailOtp) is
 * already live in production via EMAIL_PROVIDER/Resend — no TODO there.
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
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async requestOtp(phone: string): Promise<{ message: string }> {
    const otp = this.issueOtp(phone);
    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      this.logger.log(`[DEV] OTP for ${phone}: ${otp}`);
    } else {
      await this.sendOtpSms(phone, otp);
    }

    return { message: 'OTP sent' };
  }

  /**
   * Phone counterpart to sendOtpEmail — same error-surface contract: a failed
   * send throws a BadRequestException the candidate sees, never a silent "OTP
   * sent" that leaves them waiting for a code that never arrives. The OTP is
   * still consumed from the rate-limit budget on a failed send (issueOtp
   * already ran), matching the email path's lack of special-cased rollback.
   */
  private async sendOtpSms(phone: string, otp: string): Promise<void> {
    try {
      await this.smsProvider.sendOtp({ to: phone, otp });
    } catch (err) {
      this.logger.error(`Failed to send OTP SMS: ${(err as Error).message}`);
      throw new BadRequestException('Could not send the verification code. Please try again.');
    }
  }

  /**
   * Employer-signup counterpart to requestOtp, keyed by (normalized) email
   * instead of phone — issueOtp below is the exact same rate-limit/expiry/
   * generation machinery either path uses, just called with a different map
   * key. Unlike phone (SMS delivery is still unimplemented, see requestOtp
   * above), this actually delivers: Resend is already live in production for
   * notification emails (see NotificationsService), so the code goes out for
   * real via EMAIL_PROVIDER. In dev the code is logged instead of sent, same
   * convenience requestOtp gives the phone path, so local/dev testing never
   * depends on a configured Resend API key — and the code is never echoed
   * back in the API response either way, so the client can't prefill it.
   *
   * assertCompanyEmail only runs when no account exists yet for this email
   * — a signup-time gate, not a login gate (existing employer accounts,
   * including free-provider ones grandfathered from before this check
   * shipped, must keep logging in regardless of domain; see
   * verifyEmailOtp's identical `existing`-gated call for the authoritative
   * check — this one is just an early, pre-send rejection so a blocked
   * signup doesn't burn an OTP email and a round trip for nothing).
   */
  async requestEmailOtp(rawEmail: string): Promise<{ message: string }> {
    const email = normalizeEmail(rawEmail);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (!existing) assertCompanyEmail(email);

    const otp = this.issueOtp(email);
    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      this.logger.log(`[DEV] Employer signup OTP for ${email}: ${otp}`);
    } else {
      await this.sendOtpEmail(email, otp);
    }

    return { message: 'OTP sent' };
  }

  /**
   * Candidate counterpart to requestEmailOtp (employer) — same issueOtp
   * machinery (rate limits/expiry/generation), keyed by (normalized) email,
   * same dev-log/production-send split. Distinct copy from the employer
   * email (see sendCandidateOtpEmail vs sendOtpEmail) since this is what a
   * first-time candidate reads, not an employer.
   */
  async requestCandidateEmailOtp(rawEmail: string): Promise<{ message: string }> {
    const email = normalizeEmail(rawEmail);
    const otp = this.issueOtp(email);
    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      this.logger.log(`[DEV] Candidate signup OTP for ${email}: ${otp}`);
    } else {
      await this.sendCandidateOtpEmail(email, otp);
    }

    return { message: 'OTP sent' };
  }

  /**
   * Request an OTP to accept a pending team-member invitation. Keyed with
   * an "invite:" prefix (see inviteOtpKey) distinct from requestEmailOtp's
   * plain-email key, so a concurrent employer-signup OTP request for the
   * same address can never satisfy (or be satisfied by) this one — they're
   * different flows that happen to share issueOtp/consumeOtp's machinery.
   */
  async requestInviteOtp(rawEmail: string): Promise<{ message: string }> {
    const email = normalizeEmail(rawEmail);
    const invitation = await this.findAcceptableInvitation(email);
    if (!invitation) {
      throw new BadRequestException(
        'No pending invitation was found for this email. Ask your admin to send a new one.',
      );
    }

    const otp = this.issueOtp(this.inviteOtpKey(email));
    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      this.logger.log(`[DEV] Invite-accept OTP for ${email}: ${otp}`);
    } else {
      await this.sendInviteOtpEmail(email, otp);
    }

    return { message: 'OTP sent' };
  }

  /** Candidate-facing copy for sendOtpEmail's employer version — same delivery/error-propagation contract, see that method's doc comment. */
  private async sendCandidateOtpEmail(email: string, otp: string): Promise<void> {
    const subject = 'Your MyAmbii verification code';
    const minutes = Math.round(this.OTP_TTL_MS / 60000);
    const html = `
      <p>You're signing up for MyAmbii.</p>
      <p>Your verification code is:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${otp}</p>
      <p>This code expires in ${minutes} minutes. If you didn't request this, you can safely ignore this email.</p>
    `;

    try {
      await this.emailProvider.send({ to: email, subject, html });
    } catch (err) {
      this.logger.error(`Failed to send candidate signup OTP email: ${(err as Error).message}`);
      throw new BadRequestException('Could not send the verification code. Please try again.');
    }
  }

  /**
   * Shared rate-limit/expiry/generation core for both requestOtp (phone) and
   * requestEmailOtp (email) — otpStore is keyed by whatever identifier the
   * caller passes in, so the cooldown/max-sends/TTL rules apply identically
   * regardless of channel. Delivery is entirely the caller's job; this only
   * ever produces and stores the code.
   */
  private issueOtp(key: string): string {
    const now = Date.now();
    const existing = this.otpStore.get(key);

    if (existing && now - existing.lastSentAt < this.RESEND_COOLDOWN_MS) {
      throw new TooManyRequestsException('Please wait before requesting another OTP.');
    }
    if (existing && existing.sentCount >= this.MAX_SENDS_PER_WINDOW && now < existing.expiresAt) {
      throw new TooManyRequestsException('Too many OTP requests. Try again later.');
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const otp = isDev ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();

    this.otpStore.set(key, {
      otp,
      expiresAt: now + this.OTP_TTL_MS,
      attempts: 0,
      lastSentAt: now,
      sentCount: (existing?.sentCount ?? 0) + 1,
    });

    return otp;
  }

  /**
   * Failure here is surfaced to the caller (unlike NotificationsService's
   * best-effort/never-throws contract) — the candidate has no other way to
   * get this code, so a silent failure would leave them stuck on the OTP
   * screen with no path forward. The OTP itself is still consumed from the
   * rate-limit budget on a failed send (issueOtp already ran); that's an
   * acceptable trade for keeping this path simple, matching the phone path's
   * lack of any special-cased retry/rollback on send failure.
   */
  private async sendOtpEmail(email: string, otp: string): Promise<void> {
    const subject = 'Your MyAmbii for Employers signup code';
    const minutes = Math.round(this.OTP_TTL_MS / 60000);
    const html = `
      <p>You're signing up for MyAmbii for Employers.</p>
      <p>Your verification code is:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${otp}</p>
      <p>This code expires in ${minutes} minutes. If you didn't request this, you can safely ignore this email.</p>
    `;

    try {
      await this.emailProvider.send({ to: email, subject, html });
    } catch (err) {
      this.logger.error(`Failed to send employer signup OTP email: ${(err as Error).message}`);
      throw new BadRequestException('Could not send the verification code. Please try again.');
    }
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
    this.consumeOtp(phone, otp);

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
      ? await this.createEmployer(orgName as string, { phone })
      : await this.prisma.user.create({
          data: { phone, profile: { create: {} }, termsAcceptances: this.termsAcceptanceWrite() },
        });

    return this.issueTokens(user.id, user.role, {
      id: user.id,
      phone: user.phone,
      role: user.role,
    });
  }

  /**
   * Email counterpart to verifyOtp, for employer signup/login only — there's
   * no plain-candidate email flow, so (unlike verifyOtp) orgName is always
   * required and the cross-flow guard collapses to one direction: a
   * candidate account can't log in here, but there's no "not an employer
   * flow" branch to guard the other way. Single-use verification itself
   * (consumeOtp) is identical to the phone path, just keyed by email.
   *
   * assertCompanyEmail runs only in the brand-new-account branch below —
   * the authoritative signup-time gate (requestEmailOtp's own call is just
   * an early rejection; this one is what actually stops createEmployer).
   * The `existing` branch above it is deliberately never gated: an
   * already-registered employer — including a free-provider address
   * grandfathered in from before this check existed — must keep logging in
   * regardless of domain. Only account *creation* is restricted.
   */
  async verifyEmailOtp(rawEmail: string, otp: string, orgName: string) {
    const email = normalizeEmail(rawEmail);
    this.consumeOtp(email, otp);

    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (!EMPLOYER_ROLES.includes(existing.role)) {
        throw new BadRequestException(
          'This email is already registered as a candidate. Log in from the candidate app.',
        );
      }
      return this.issueTokens(existing.id, existing.role, this.publicUser(existing));
    }

    assertCompanyEmail(email);
    const user = await this.createEmployer(orgName, { email });
    return this.issueTokens(user.id, user.role, this.publicUser(user));
  }

  /**
   * Email counterpart to verifyOtp's plain-candidate branch (orgName
   * omitted) — same single-use/attempt-capped verification (consumeOtp)
   * and the same provisioning shape as the phone path: `profile: { create:
   * {} }`, role left to its schema default of CANDIDATE. Mirrors
   * verifyEmailOtp's (employer) cross-role guard in the opposite
   * direction — an email already registered as an employer is rejected
   * here rather than silently logged in as one. User.email is `@unique`
   * with a single `role` column, so (matching the phone path's existing
   * cross-flow guard) one identifier can never hold both roles at once;
   * this just enforces the same rule email-side.
   */
  async verifyCandidateEmailOtp(rawEmail: string, otp: string) {
    const email = normalizeEmail(rawEmail);
    this.consumeOtp(email, otp);

    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (EMPLOYER_ROLES.includes(existing.role)) {
        throw new BadRequestException(
          'This email is already registered as an employer. Log in from the employer portal.',
        );
      }
      return this.issueTokens(existing.id, existing.role, this.publicUser(existing));
    }

    const user = await this.prisma.user.create({
      data: { email, profile: { create: {} }, termsAcceptances: this.termsAcceptanceWrite() },
    });
    return this.issueTokens(user.id, user.role, this.publicUser(user));
  }

  /**
   * Verifies the invite-accept OTP, then either links an existing account
   * to the inviting org or provisions a brand-new EMPLOYER_MEMBER.
   * loginEmployerWithIdentity's doc comment says employer accounts are
   * "provisioned manually" and never auto-created on login — this is that
   * manual provisioning step: an admin's own invite action, not a bare
   * OAuth/OTP login inventing an org membership out of nothing.
   */
  async acceptInvite(rawEmail: string, otp: string) {
    const email = normalizeEmail(rawEmail);
    this.consumeOtp(this.inviteOtpKey(email), otp);

    const invitation = await this.findAcceptableInvitation(email);
    if (!invitation) {
      throw new BadRequestException('This invitation is no longer available. Ask your admin to send a new one.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    let userId: string;
    let role: Role;

    if (existing) {
      if (!EMPLOYER_ROLES.includes(existing.role)) {
        throw new BadRequestException(
          'This email is already registered as a candidate account. Use a different email to accept this invitation.',
        );
      }
      const alreadyMember = await this.prisma.orgMember.findUnique({ where: { userId: existing.id } });
      if (alreadyMember) {
        throw new BadRequestException('This email already belongs to an organization.');
      }
      // An employer-role user with no OrgMember shouldn't exist under
      // today's invariants (every path that sets an employer role creates
      // OrgMember in the same transaction) — handled defensively rather
      // than assumed impossible: link them without touching their role.
      await this.prisma.orgMember.create({
        data: { userId: existing.id, organizationId: invitation.organizationId },
      });
      userId = existing.id;
      role = existing.role;
    } else {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, role: Role.EMPLOYER_MEMBER, termsAcceptances: this.termsAcceptanceWrite() },
        });
        await tx.orgMember.create({ data: { userId: user.id, organizationId: invitation.organizationId } });
        return user;
      });
      userId = created.id;
      role = created.role;
    }

    await this.prisma.orgInvitation.update({
      where: { id: invitation.id },
      data: { status: OrgInvitationStatus.ACCEPTED, acceptedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.issueTokens(userId, role, this.publicUser(user));
  }

  /** Namespaced apart from requestEmailOtp's plain-email key — see requestInviteOtp's doc comment. */
  private inviteOtpKey(email: string): string {
    return `invite:${email}`;
  }

  /**
   * The latest PENDING invitation for this email, or null if there isn't
   * one — lazily flips an overdue-but-still-PENDING row to EXPIRED on the
   * way out, same self-healing check OrgMembersService.expirePastDue does
   * for the org-facing list, so accept can never succeed against a row
   * that's actually past its deadline just because no sweep has run yet.
   */
  private async findAcceptableInvitation(email: string) {
    const invitation = await this.prisma.orgInvitation.findFirst({
      where: { email, status: OrgInvitationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    if (!invitation) return null;
    if (invitation.expiresAt < new Date()) {
      await this.prisma.orgInvitation.update({
        where: { id: invitation.id },
        data: { status: OrgInvitationStatus.EXPIRED },
      });
      return null;
    }
    return invitation;
  }

  /** Same delivery/error-propagation contract as sendOtpEmail — see that method's doc comment. */
  private async sendInviteOtpEmail(email: string, otp: string): Promise<void> {
    const subject = 'Your MyAmbii invitation code';
    const minutes = Math.round(this.OTP_TTL_MS / 60000);
    const html = `
      <p>You're accepting a team invitation on MyAmbii.</p>
      <p>Your verification code is:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${otp}</p>
      <p>This code expires in ${minutes} minutes. If you didn't request this, you can safely ignore this email.</p>
    `;

    try {
      await this.emailProvider.send({ to: email, subject, html });
    } catch (err) {
      this.logger.error(`Failed to send invite-accept OTP email: ${(err as Error).message}`);
      throw new BadRequestException('Could not send the verification code. Please try again.');
    }
  }

  /**
   * Shared single-use/attempt-capped verification core for both verifyOtp
   * (phone) and verifyEmailOtp (email) — same otpStore consumeOtp draws
   * from, keyed by whatever issueOtp stored it under.
   */
  private consumeOtp(key: string, otp: string): void {
    const entry = this.otpStore.get(key);

    if (!entry || Date.now() > entry.expiresAt) {
      throw new BadRequestException('OTP expired or not requested. Request a new one.');
    }
    if (entry.attempts >= this.MAX_VERIFY_ATTEMPTS) {
      this.otpStore.delete(key);
      throw new TooManyRequestsException('Too many incorrect attempts. Request a new OTP.');
    }

    entry.attempts += 1;
    if (entry.otp !== otp) {
      throw new BadRequestException('Incorrect OTP.');
    }

    this.otpStore.delete(key); // single-use
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
            // OAuth self-provisions accounts without ever showing the signup
            // card, so this is the path most at risk of skipping the record —
            // stamped here so it never can (see termsAcceptanceWrite).
            termsAcceptances: this.termsAcceptanceWrite(),
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
        `This ${provider} account is already linked to a different MyAmbii account.`,
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

  /**
   * OTP-verified linking of a SECOND login identifier (phone or email) onto
   * the CURRENT account — the authenticated counterpart to connectProvider
   * above, and the answer to the phone/email split-account problem: a User
   * already has both a phone and an email column, so a candidate who signed
   * up one way can attach the other to the SAME row instead of creating a
   * second account with split badges. Only ever ADDS a missing identifier
   * (assert*Linkable below); changing an existing one is deliberately out of
   * scope. OTP keys are namespaced (linkPhoneOtpKey/linkEmailOtpKey) so a link
   * code can never be satisfied by — or satisfy — a concurrent login OTP for
   * the same value, the same isolation the invite flow uses.
   */
  private linkPhoneOtpKey(phone: string): string {
    return `link-phone:${phone}`;
  }
  private linkEmailOtpKey(email: string): string {
    return `link-email:${email}`;
  }

  async requestLinkPhoneOtp(userId: string, phone: string): Promise<{ message: string }> {
    await this.assertPhoneLinkable(userId, phone);
    const otp = this.issueOtp(this.linkPhoneOtpKey(phone));
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      this.logger.log(`[DEV] Link-phone OTP for ${phone}: ${otp}`);
    } else {
      await this.sendOtpSms(phone, otp);
    }
    return { message: 'OTP sent' };
  }

  async verifyLinkPhoneOtp(userId: string, phone: string, otp: string) {
    this.consumeOtp(this.linkPhoneOtpKey(phone), otp);
    // Re-check at commit — the request-time guard can go stale across the OTP window.
    await this.assertPhoneLinkable(userId, phone);
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { phone } });
    } catch (err) {
      if (this.isUniqueConstraintError(err, 'phone')) {
        // Same vague copy as the request-time guard — the constraint firing
        // here means another account took the number during the OTP window,
        // which we must not disclose any more than at request time.
        throw new ConflictException(PHONE_NOT_LINKABLE_MESSAGE);
      }
      throw err;
    }
    return { ok: true, phone };
  }

  async requestLinkEmailOtp(userId: string, rawEmail: string): Promise<{ message: string }> {
    const email = normalizeEmail(rawEmail);
    await this.assertEmailLinkable(userId, email);
    const otp = this.issueOtp(this.linkEmailOtpKey(email));
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      this.logger.log(`[DEV] Link-email OTP for ${email}: ${otp}`);
    } else {
      await this.sendLinkOtpEmail(email, otp);
    }
    return { message: 'OTP sent' };
  }

  async verifyLinkEmailOtp(userId: string, rawEmail: string, otp: string) {
    const email = normalizeEmail(rawEmail);
    this.consumeOtp(this.linkEmailOtpKey(email), otp);
    await this.assertEmailLinkable(userId, email);
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { email } });
    } catch (err) {
      if (this.isUniqueConstraintError(err, 'email')) {
        // Same vague copy as the request-time guard — see the phone path above.
        throw new ConflictException(EMAIL_NOT_LINKABLE_MESSAGE);
      }
      throw err;
    }
    return { ok: true, email };
  }

  /** The current account must not already carry a phone, and the phone must not belong to another account. */
  private async assertPhoneLinkable(userId: string, phone: string): Promise<void> {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (me.phone) {
      throw new BadRequestException('Your account already has a phone number.');
    }
    const taken = await this.prisma.user.findUnique({ where: { phone } });
    if (taken && taken.id !== userId) {
      throw new BadRequestException(PHONE_NOT_LINKABLE_MESSAGE);
    }
  }

  /**
   * Email counterpart to assertPhoneLinkable — case-insensitive match, same
   * as findVerifiedEmailMatch. Employer-only domain gate bolted on here too
   * (checked only when `me` already holds an employer role — candidates are
   * unaffected): without it, a phone-first employer could attach a personal
   * Gmail address via this generic link flow and then use it to log in
   * through verifyEmailOtp's `existing` branch, which never re-checks the
   * domain — sidestepping the signup-time gate entirely. Called from both
   * requestLinkEmailOtp and verifyLinkEmailOtp (same "recheck at commit"
   * pattern as the rest of this method), so gating it once here covers both.
   */
  private async assertEmailLinkable(userId: string, email: string): Promise<void> {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (me.email) {
      throw new BadRequestException('Your account already has an email address.');
    }
    if (EMPLOYER_ROLES.includes(me.role)) {
      assertCompanyEmail(email);
    }
    const taken = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (taken && taken.id !== userId) {
      throw new BadRequestException(EMAIL_NOT_LINKABLE_MESSAGE);
    }
  }

  /** Add-email-to-account copy — distinct from the signup email (sendCandidateOtpEmail). */
  private async sendLinkOtpEmail(email: string, otp: string): Promise<void> {
    const subject = 'Your MyAmbii verification code';
    const minutes = Math.round(this.OTP_TTL_MS / 60000);
    const html = `
      <p>You're adding this email to your MyAmbii account.</p>
      <p>Your verification code is:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${otp}</p>
      <p>This code expires in ${minutes} minutes. If you didn't request this, you can safely ignore this email.</p>
    `;
    try {
      await this.emailProvider.send({ to: email, subject, html });
    } catch (err) {
      this.logger.error(`Failed to send link-email OTP: ${(err as Error).message}`);
      throw new BadRequestException('Could not send the verification code. Please try again.');
    }
  }

  /**
   * The nested-write payload that stamps a Terms/Privacy acceptance onto a
   * User at the moment it's created. Inlined into every user.create (nested,
   * so it lands in the same statement/transaction as the account itself) —
   * an account can never come into existence without its acceptance row,
   * which is the whole point: it must evidence what was agreed to, when, and
   * against which document versions. ageConfirmed captures the passive "you
   * confirm you are 18 or over" the signup line states; the versions pin the
   * documents in force (see legal-terms.ts). Every self-provisioning path —
   * including OAuth, which never shows a signup card — goes through a
   * user.create, so routing this through one shared payload is what keeps
   * the OAuth path from silently being the one that's missing a record.
   */
  private termsAcceptanceWrite() {
    return {
      create: {
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        ageConfirmed: true,
      },
    };
  }

  /**
   * The most recent acceptance on record for a user, or null for an account
   * created before this feature shipped (deliberately never backfilled).
   * Exposed via GET /auth/terms-acceptance so a record is retrievable per
   * user — for support/audit or a future re-acceptance flow. Ordered
   * newest-first against the day the model allows more than one row.
   */
  async getTermsAcceptance(userId: string) {
    return this.prisma.termsAcceptance.findFirst({
      where: { userId },
      orderBy: { acceptedAt: 'desc' },
      select: { termsVersion: true, privacyVersion: true, ageConfirmed: true, acceptedAt: true },
    });
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

  /**
   * Creates the User, Organization, and OrgMember link atomically — shared
   * by the phone (verifyOtp) and email (verifyEmailOtp) employer-signup
   * paths, which only differ in which identifier they create the User with.
   */
  private async createEmployer(orgName: string, identity: { phone: string } | { email: string }) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { ...identity, role: Role.EMPLOYER_ADMIN, termsAcceptances: this.termsAcceptanceWrite() },
      });
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
