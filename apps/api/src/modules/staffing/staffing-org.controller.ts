import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OrgType, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { OrgSetupCompleteGuard } from '../auth/org-setup-complete.guard';
import { AllowOrgTypes, OrgVerifiedGuard } from '../auth/org-verified.guard';
import { StaffingService } from './staffing.service';
import { CreateStaffingRequestDto, SearchStaffingCandidatesDto } from './staffing.dto';

/**
 * The staffing company's side. Same guard stack as the employer portal, but
 * AllowOrgTypes(STAFFING) flips OrgVerifiedGuard's org-type check: only a
 * verified staffing company gets in, and an employer org is refused here
 * just as a staffing org is refused on every employer route.
 */
@Controller('staffing')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard, OrgVerifiedGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
@AllowOrgTypes(OrgType.STAFFING)
export class StaffingOrgController {
  constructor(private readonly svc: StaffingService) {}

  @Get('candidates')
  search(@Req() req: OrgScopedRequest, @Query() dto: SearchStaffingCandidatesDto) {
    return this.svc.search(req.orgId, dto);
  }

  @Get('requests')
  requests(@Req() req: OrgScopedRequest) {
    return this.svc.listOrgRequests(req.orgId);
  }

  @Post('requests')
  create(@Req() req: OrgScopedRequest, @Body() dto: CreateStaffingRequestDto) {
    return this.svc.createRequest(req.orgId, req.user.sub, dto);
  }

  @Post('requests/:id/withdraw')
  withdraw(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.withdraw(req.orgId, id);
  }
}
