import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgType, OrgVerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedRequest } from './org-member.guard';

export const ALLOWED_ORG_TYPES_KEY = 'allowedOrgTypes';

/**
 * Which Organization.type values may use a controller/route guarded by
 * OrgVerifiedGuard. Default (no decorator) is EMPLOYER only — so every
 * existing employer-portal controller (jobs, candidates, shortlist,
 * applicants, dashboard, assessment requests) refuses a staffing company
 * without being edited, and in particular the full-name employer candidate
 * search can never be reached by one. StaffingOrgController opts in with
 * @AllowOrgTypes(OrgType.STAFFING).
 */
export const AllowOrgTypes = (...types: OrgType[]) => SetMetadata(ALLOWED_ORG_TYPES_KEY, types);

/**
 * Runs after OrgMemberGuard (and, on every controller that carries both,
 * alongside OrgSetupCompleteGuard — order between the two doesn't matter:
 * an org can't reach PENDING/VERIFIED without having been setup-complete
 * at submission time, see OrgsService's auto-submit, so in practice
 * OrgSetupCompleteGuard is already satisfied whenever this one is the
 * blocker). Rejects with ORG_TYPE_NOT_ALLOWED when the org's type isn't one
 * this route allows (see AllowOrgTypes), then with ORG_NOT_VERIFIED unless
 * the org's verificationStatus is VERIFIED. Deliberately NOT attached to
 * OrgsController (Settings is the one place an unverified org can act) or
 * OrgMembersController (team invitations) — both org types use those.
 */
@Injectable()
export class OrgVerifiedGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OrgScopedRequest>();
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: req.orgId },
      select: { verificationStatus: true, type: true },
    });

    const allowed =
      this.reflector?.getAllAndOverride<OrgType[] | undefined>(ALLOWED_ORG_TYPES_KEY, [context.getHandler(), context.getClass()]) ??
      [OrgType.EMPLOYER];
    const type = org.type ?? OrgType.EMPLOYER;
    if (!allowed.includes(type)) {
      throw new ForbiddenException({
        code: 'ORG_TYPE_NOT_ALLOWED',
        orgType: type,
        message:
          type === OrgType.STAFFING
            ? 'This part of the portal is for employers hiring for their own company. Staffing companies use Find talent instead.'
            : 'This part of the portal is for staffing companies.',
      });
    }

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
