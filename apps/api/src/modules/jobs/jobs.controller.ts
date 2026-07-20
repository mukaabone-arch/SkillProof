import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { JobsService } from './jobs.service';
import { MatchingService } from './matching.service';
import { CreateJobDto, ParseJobDescriptionDto, SetJobSkillsDto, UpdateJobDto } from './jobs.dto';

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class JobsController {
  constructor(
    private readonly svc: JobsService,
    private readonly matching: MatchingService,
  ) {}

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

  /** Draft-only — see JobsService.remove for why LIVE/CLOSED jobs are rejected. */
  @Delete(':id')
  remove(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.remove(req.orgId, id);
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

  @Get(':id/matches')
  matches(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.matching.getMatches(req.orgId, id);
  }

  @Get(':id/applicants')
  applicants(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.getApplicants(req.orgId, id);
  }

  /** Streams the applicant's raw uploaded resume PDF — gated by JobsService.getApplicantResume (employerCanViewCandidate). */
  @Get(':jobId/applicants/:candidateId/resume')
  @Header('Content-Type', 'application/pdf')
  async applicantResume(
    @Req() req: OrgScopedRequest,
    @Param('jobId') jobId: string,
    @Param('candidateId') candidateId: string,
  ) {
    const { buffer, filename } = await this.svc.getApplicantResume(req.orgId, jobId, candidateId);
    return new StreamableFile(buffer, { disposition: `attachment; filename="${filename}"` });
  }
}
