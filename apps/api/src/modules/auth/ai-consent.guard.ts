import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from './jwt-auth.guard';

export const AI_CONSENT_REQUIRED = 'AI_CONSENT_REQUIRED';

/**
 * Blocks starting a session whose answers are sent to our AI provider until
 * the user has agreed to that (User.aiConsentAt — set once via
 * POST /profiles/me/ai-consent). App Store guideline 5.1.2(i) requires clear
 * disclosure + consent before personal data is shared with a third-party AI;
 * enforcing it here, not only in the UI, means no client (web, app, or a
 * browser tab opened directly) can skip the notice.
 *
 * Attach it BEFORE EntitlementGuard (`@UseGuards(AiConsentGuard,
 * EntitlementGuard)`) so a candidate who hasn't agreed is never charged a
 * quota unit for a session that didn't start.
 *
 * `code` follows the LIMIT_REACHED / CANDIDATE_VERIFICATION_INCOMPLETE
 * convention — clients branch on it to show the consent notice instead of a
 * raw error message.
 */
@Injectable()
export class AiConsentGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { aiConsentAt: true },
    });
    if (user?.aiConsentAt) return true;
    throw new ForbiddenException({
      code: AI_CONSENT_REQUIRED,
      message: 'Please agree to AI evaluation of your answers before starting.',
    });
  }
}
