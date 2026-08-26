import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertOrgSetupComplete } from '../orgs/org-readiness';
import { OrgScopedRequest } from './org-member.guard';

/**
 * Runs after OrgMemberGuard — needs req.orgId already set. Rejects with
 * ORG_SETUP_INCOMPLETE (see org-readiness.ts) unless the org has a logo,
 * industry, and website on file. Attached directly to the controllers that
 * make up the employer portal proper (jobs, shortlist, dashboard,
 * candidates, applications, assessment-requests) — deliberately NOT
 * attached to OrgsController (the org-info/logo edit routes an incomplete
 * org needs to actually comply) or OrgMembersController (team invitations
 * are explicitly not part of this gate). Both exemptions are whole-
 * controller, so there's no partial-route exemption mechanism here — if a
 * future route needs a narrower carve-out, that's the point to add one,
 * not before.
 */
@Injectable()
export class OrgSetupCompleteGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OrgScopedRequest>();
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: req.orgId },
      select: { logoKey: true, industry: true, industryOther: true, website: true },
    });
    assertOrgSetupComplete(org);
    return true;
  }
}
