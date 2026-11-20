import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { OrgType, OrgVerificationStatus } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { InMemoryRateLimiter } from '../../common/ip-rate-limiter';
import { API_KEY_PREFIX, hashApiKey } from '../webhooks/webhooks.util';

export interface ApiKeyRequest extends Request {
  orgId: string;
  orgType: OrgType;
  apiKeyId: string;
  /** Whoever created the key — recorded as the actor for writes made with it. */
  apiKeyUserId: string;
}

const LAST_USED_EVERY_MS = 5 * 60 * 1000;

/**
 * API v1 authentication: "Authorization: Bearer mya_…" (or "X-API-Key").
 * Only the key's SHA-256 is stored, so a lookup is by hash. The org must
 * still be verified and active, exactly as for the portal. 120 requests a
 * minute per key.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly limiter = new InMemoryRateLimiter(0, 120, 60_000);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyRequest>();
    const auth = req.headers.authorization;
    const raw = (auth?.startsWith('Bearer ') ? auth.slice(7) : (req.headers['x-api-key'] as string | undefined))?.trim();
    if (!raw || !raw.startsWith(API_KEY_PREFIX)) throw new UnauthorizedException('Send your MyAmbii API key as "Authorization: Bearer mya_…".');

    const key = await this.prisma.orgApiKey.findUnique({
      where: { keyHash: hashApiKey(raw) },
      include: { organization: { select: { type: true, verificationStatus: true, deactivatedAt: true } } },
    });
    if (!key || key.revokedAt) throw new UnauthorizedException('This API key is not valid or has been revoked.');
    if (key.organization.deactivatedAt || key.organization.verificationStatus !== OrgVerificationStatus.VERIFIED) {
      throw new ForbiddenException('This organisation is not active on MyAmbii.');
    }
    this.limiter.hit(key.id, 'Rate limit: 120 requests a minute per key.');

    req.orgId = key.orgId;
    req.orgType = key.organization.type ?? OrgType.EMPLOYER;
    req.apiKeyId = key.id;
    req.apiKeyUserId = key.createdByUserId;
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
      void this.prisma.orgApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return true;
  }
}
