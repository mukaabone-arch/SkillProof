import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { ApplicationsService } from './applications.service';
import { UpdateApplicationStatusDto } from './applications.dto';

/** Employer-facing application management — separate from the candidate ApplicationsController above. */
@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class EmployerApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Patch(':id/status')
  updateStatus(
    @Req() req: OrgScopedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    return this.svc.updateStatus(req.orgId, req.user.sub, id, dto.status);
  }
}
