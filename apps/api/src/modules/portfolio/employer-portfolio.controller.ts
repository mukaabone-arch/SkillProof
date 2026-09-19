import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { OrgSetupCompleteGuard } from '../auth/org-setup-complete.guard';
import { OrgVerifiedGuard } from '../auth/org-verified.guard';
import { PortfolioService } from './portfolio.service';

/** Employer half — reachable only from the applicant/shortlist views an org already has, never a browsable directory. See PortfolioService.getForEmployer for the access gate. */
@Controller('portfolio/candidates')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard, OrgVerifiedGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class EmployerPortfolioController {
  constructor(private readonly svc: PortfolioService) {}

  @Get(':id')
  getForCandidate(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.getForEmployer(req.orgId, id);
  }
}
