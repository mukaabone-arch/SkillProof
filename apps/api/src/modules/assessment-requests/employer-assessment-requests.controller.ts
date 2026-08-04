import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { AssessmentRequestsService } from './assessment-requests.service';
import { InitiateAssessmentRequestDto, VerifyAssessmentRequestPaymentDto } from './assessment-requests.dto';

/**
 * Employer half of the pay-per-assessment flow — "Assess candidate" on the
 * shortlist. See AssessmentRequestsService for the state machine; this
 * controller is a thin pass-through, same convention as ShortlistController.
 */
@Controller('assessment-requests')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class EmployerAssessmentRequestsController {
  constructor(private readonly svc: AssessmentRequestsService) {}

  @Post()
  initiate(@Req() req: OrgScopedRequest, @Body() dto: InitiateAssessmentRequestDto) {
    return this.svc.initiate(req.orgId, req.user.sub, dto.candidateId, dto.skillId, dto.level);
  }

  @Post('verify')
  verify(@Req() req: OrgScopedRequest, @Body() dto: VerifyAssessmentRequestPaymentDto) {
    return this.svc.verifyAndCreate(req.orgId, dto.razorpay_order_id, dto.razorpay_payment_id, dto.razorpay_signature);
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
