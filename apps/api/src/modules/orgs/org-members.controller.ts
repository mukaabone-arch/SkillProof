import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { OrgMembersService } from './org-members.service';
import { InviteMemberDto } from './org-members.dto';

/**
 * Team management. List is available to both roles (a member can see who
 * else is on the team); every mutation is admin-only — inviting, removing,
 * and promoting/demoting all either spend a seat or change who can spend
 * the organization's money, which is exactly this feature's admin/member
 * dividing line. Hiding these actions in the UI for a member is a UX
 * courtesy only; @Roles below is the actual enforcement (same distinction
 * OrgScopedRequest/OrgMemberGuard's own doc comments draw elsewhere in this
 * codebase).
 */
@Controller('orgs/members')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
export class OrgMembersController {
  constructor(private readonly svc: OrgMembersService) {}

  @Get()
  @Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
  list(@Req() req: OrgScopedRequest) {
    return this.svc.list(req.orgId);
  }

  @Post('invite')
  @Roles(Role.EMPLOYER_ADMIN)
  invite(@Req() req: OrgScopedRequest, @Body() dto: InviteMemberDto) {
    return this.svc.invite(req.orgId, req.user.sub, dto.email);
  }

  @Delete('invitations/:id')
  @Roles(Role.EMPLOYER_ADMIN)
  revokeInvitation(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.revokeInvitation(req.orgId, id);
  }

  @Delete(':id')
  @Roles(Role.EMPLOYER_ADMIN)
  remove(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.remove(req.orgId, req.user.sub, id);
  }

  @Patch(':id/promote')
  @Roles(Role.EMPLOYER_ADMIN)
  promote(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.promote(req.orgId, id);
  }

  @Patch(':id/demote')
  @Roles(Role.EMPLOYER_ADMIN)
  demote(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.demote(req.orgId, id);
  }
}
