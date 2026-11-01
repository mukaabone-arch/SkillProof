import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OrgType, Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { OrgSetupCompleteGuard } from '../auth/org-setup-complete.guard';
import { AllowOrgTypes, OrgVerifiedGuard } from '../auth/org-verified.guard';
import { StaffingSubmissionsService } from './staffing-submissions.service';
import {
  CreateStaffingClientDto,
  CreateStaffingSubmissionDto,
  DecideSubmissionDto,
  UpdateStaffingClientDto,
  UpdateSubmissionStatusDto,
} from './staffing-submissions.dto';

/** Staffing company: client list + submissions (verified STAFFING orgs only — see AllowOrgTypes). */
@Controller('staffing')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard, OrgVerifiedGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
@AllowOrgTypes(OrgType.STAFFING)
export class StaffingSubmissionsOrgController {
  constructor(private readonly svc: StaffingSubmissionsService) {}

  @Get('clients')
  clients(@Req() req: OrgScopedRequest, @Query('archived') archived?: string) {
    return this.svc.listClients(req.orgId, archived === 'true');
  }

  @Post('clients')
  createClient(@Req() req: OrgScopedRequest, @Body() dto: CreateStaffingClientDto) {
    return this.svc.createClient(req.orgId, dto);
  }

  @Patch('clients/:id')
  updateClient(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: UpdateStaffingClientDto) {
    return this.svc.updateClient(req.orgId, id, dto);
  }

  @Get('submissions')
  submissions(@Req() req: OrgScopedRequest) {
    return this.svc.listOrgSubmissions(req.orgId);
  }

  @Post('submissions')
  submit(@Req() req: OrgScopedRequest, @Body() dto: CreateStaffingSubmissionDto) {
    return this.svc.createSubmission(req.orgId, req.user.sub, dto);
  }

  @Patch('submissions/:id/status')
  status(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: UpdateSubmissionStatusDto) {
    return this.svc.updateStatus(req.orgId, id, dto.status);
  }
}

/** Candidate: approve/decline being submitted, see status, withdraw consent. */
@Controller('staffing/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class StaffingSubmissionsCandidateController {
  constructor(private readonly svc: StaffingSubmissionsService) {}

  @Get('submissions')
  mine(@Req() req: AuthenticatedRequest) {
    return this.svc.listMySubmissions(req.user.sub);
  }

  @Post('submissions/:id/decide')
  decide(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: DecideSubmissionDto) {
    return this.svc.decide(req.user.sub, id, dto);
  }

  @Post('submissions/:id/withdraw')
  withdraw(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.candidateWithdraw(req.user.sub, id);
  }
}
