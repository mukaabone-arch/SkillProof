import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

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

  async verifyOtp(phone: string, otp: string) {
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

    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, profile: { create: {} } },
    });

    return this.issueTokens(user.id, user.role, {
      id: user.id,
      phone: user.phone,
      role: user.role,
    });
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
