import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedRequest } from './org-member.guard';

/**
 * Enforces Organization.deactivatedAt as a real access gate — every
 * OrgMember of a deactivated org is blocked, not just hidden from someone
 * else's query (contrast CandidateProfile.deactivatedAt, a passive
 * visibility filter with no access blocking at all). Embedded into
 * OrgMemberGuard itself (see that guard's own doc comment) rather than
 * attached per-controller: OrgMemberGuard is already the one guard every
 * employer-portal controller depends on to resolve req.orgId in the first
 * place, so this is the one choke point that structurally cannot be
 * missed by a future controller — same reasoning that put
 * CandidateVerificationGuard inside JwtAuthGuard rather than as a
 * per-controller @UseGuards entry.
 *
 * Runs after OrgMemberGuard has set req.orgId. No skip mechanism, unlike
 * CandidateVerificationGuard/OrgSetupCompleteGuard — deactivation has no
 * self-service compliance path at all (only a platform admin can
 * reactivate), so there's nothing that needs to stay writable for a
 * deactivated org, and OrgsController.me (the one read a deactivated
 * org's members need, to see why they're blocked) already bypasses
 * OrgMemberGuard entirely via its own manual membership lookup — it never
 * reaches this guard in the first place. If a future route genuinely
 * needs a narrower carve-out, that's the point to add one, not before —
 * same reasoning OrgSetupCompleteGuard's own doc comment gives for the
 * same design choice.
 */
@Injectable()
export class OrgActiveGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OrgScopedRequest>();
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: req.orgId },
      select: { deactivatedAt: true },
    });
    if (org.deactivatedAt) {
      throw new ForbiddenException({
        code: 'ORG_DEACTIVATED',
        message: 'This organization has been deactivated. Contact support to have it reactivated.',
      });
    }
    return true;
  }
}
