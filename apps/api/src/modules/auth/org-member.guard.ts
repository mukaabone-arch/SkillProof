import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from './jwt-auth.guard';

export interface OrgScopedRequest extends AuthenticatedRequest {
  orgId: string;
}

/** Runs after JwtAuthGuard — requires the caller to be a member of an Organization. */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OrgScopedRequest>();
    const membership = await this.prisma.orgMember.findUnique({ where: { userId: req.user.sub } });
    if (!membership) throw new ForbiddenException('This account is not linked to an organization.');
    req.orgId = membership.organizationId;
    return true;
  }
}
