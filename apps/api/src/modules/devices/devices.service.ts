import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDeviceDto } from './devices.dto';

/**
 * Push-notification device tokens (FCM). Phase 1: store and clean up only —
 * nothing sends yet. See DeviceToken in schema.prisma for why `token` is
 * unique globally rather than per user.
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert on `token`. A new token creates a row; a token already on file —
   * same user after a restart or an onTokenRefresh, or a different user who
   * signed in on the same phone — is moved to `userId` and touched, never
   * duplicated.
   */
  async register(userId: string, dto: RegisterDeviceDto) {
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform, appVersion: dto.appVersion ?? null },
      update: { userId, platform: dto.platform, appVersion: dto.appVersion ?? null },
    });
    return { ok: true };
  }

  /**
   * Authenticated removal (the app's own sign-out). Scoped to the caller so
   * one account can't unregister another's device by guessing a token.
   */
  async unregister(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { ok: true };
  }

  /**
   * Unauthenticated removal by token alone — for sign-outs that happen after
   * the access token is already gone (a rejected refresh, a forced sign-out),
   * via POST /auth/logout's `deviceToken`. Holding the device's own FCM token
   * is the proof; it is never shown to anyone but that device.
   */
  async removeByToken(token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
  }
}
