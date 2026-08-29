import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from './jwt-auth.guard';
import { OrgActiveGuard } from './org-active.guard';

export interface OrgScopedRequest extends AuthenticatedRequest {
  orgId: string;
}

/**
 * Runs after JwtAuthGuard — requires the caller to be a member of an
 * Organization. Also runs OrgActiveGuard's check inline, once req.orgId is
 * set — not attached as a separate @UseGuards entry per-controller. See
 * that guard's own doc comment for why: every employer-portal controller
 * already depends on OrgMemberGuard to resolve req.orgId, which makes this
 * the one choke point a new org-scoped route structurally cannot skip.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgActive: OrgActiveGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OrgScopedRequest>();
    const membership = await this.prisma.orgMember.findUnique({ where: { userId: req.user.sub } });
    if (!membership) throw new ForbiddenException('This account is not linked to an organization.');
    req.orgId = membership.organizationId;
    return this.orgActive.canActivate(context);
  }
}
