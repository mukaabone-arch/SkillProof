import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { JobsService } from './jobs.service';
import { CreateJobDto, ParseJobDescriptionDto, SetJobSkillsDto, UpdateJobDto } from './jobs.dto';

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  @Post()
  create(@Req() req: OrgScopedRequest, @Body() dto: CreateJobDto) {
    return this.svc.create(req.orgId, dto);
  }

  @Get()
  list(@Req() req: OrgScopedRequest) {
    return this.svc.listForOrg(req.orgId);
  }

  @Patch(':id')
  update(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.svc.update(req.orgId, id, dto);
  }

  @Post(':id/skills')
  setSkills(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: SetJobSkillsDto) {
    return this.svc.setSkills(req.orgId, id, dto.skills);
  }

  /** Employer pastes a JD; returns extracted fields for review — nothing is created here. */
  @Post('parse-description')
  parseDescription(@Body() dto: ParseJobDescriptionDto) {
    return this.svc.parseDescription(dto.description);
  }
}
