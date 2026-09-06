import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { OrgSetupCompleteGuard } from '../auth/org-setup-complete.guard';
import { AssessmentRequestsService } from './assessment-requests.service';
import { InitiateAssessmentRequestDto } from './assessment-requests.dto';

/**
 * Employer half of the postpaid assessment-request flow — "Assess
 * candidate" on the shortlist. See AssessmentRequestsService for the state
 * machine; this controller is a thin pass-through, same convention as
 * ShortlistController. No `/verify` route anymore (2026-09, prepaid ->
 * postpaid switch) — POST here both creates the request and records its
 * accrual in one call, since there's no payment step left to separate it
 * from.
 */
@Controller('assessment-requests')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class EmployerAssessmentRequestsController {
  constructor(private readonly svc: AssessmentRequestsService) {}

  /**
   * Admin-only — overrides the controller's default @Roles below. This is
   * the ₹177-per-assessment trigger: it accrues a charge against the
   * organization's account, so it sits on the admin side of this feature's
   * dividing line (see OrgMembersController's own doc comment for the same
   * rule stated once).
   */
  @Post()
  @Roles(Role.EMPLOYER_ADMIN)
  create(@Req() req: OrgScopedRequest, @Body() dto: InitiateAssessmentRequestDto) {
    return this.svc.create(req.orgId, req.user.sub, dto.candidateId, dto.skillId, dto.level);
  }

  @Get()
  list(@Req() req: OrgScopedRequest, @Query('candidateId') candidateId?: string) {
    return this.svc.listForEmployer(req.orgId, candidateId);
  }

  @Get(':id')
  get(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.getForEmployer(req.orgId, id);
  }
}
