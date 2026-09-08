import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { OrgVerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedRequest } from './org-member.guard';

/**
 * Runs after OrgMemberGuard (and, on every controller that carries both,
 * alongside OrgSetupCompleteGuard — order between the two doesn't matter:
 * an org can't reach PENDING/VERIFIED without having been setup-complete
 * at submission time, see OrgsService's auto-submit, so in practice
 * OrgSetupCompleteGuard is already satisfied whenever this one is the
 * blocker). Rejects with ORG_NOT_VERIFIED unless the org's
 * verificationStatus is VERIFIED. Attached to the same controllers as
 * OrgSetupCompleteGuard, plus DashboardController — see this feature's
 * own plan for why Dashboard is included even though it predates this
 * guard. Deliberately NOT attached to OrgsController (Settings is the one
 * place an unverified org can act — check status, fix details, wait for a
 * decision) or OrgMembersController (team invitations, same carve-out
 * OrgSetupCompleteGuard already makes and for the same reason — see that
 * guard's own doc comment).
 */
@Injectable()
export class OrgVerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OrgScopedRequest>();
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: req.orgId },
      select: { verificationStatus: true },
    });
    if (org.verificationStatus !== OrgVerificationStatus.VERIFIED) {
      throw new ForbiddenException({
        code: 'ORG_NOT_VERIFIED',
        status: org.verificationStatus,
        message:
          'Your organization must be verified before you can use this part of the employer portal. Check Settings for its current status.',
      });
    }
    return true;
  }
}
