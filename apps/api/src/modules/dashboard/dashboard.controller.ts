import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dashboard.dto';

@Controller('employer/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  summary(@Req() req: OrgScopedRequest, @Query() dto: DashboardQueryDto) {
    return this.svc.summary(req.orgId, dto.jobId);
  }
}
