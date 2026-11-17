import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { OrgType, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { OrgSetupCompleteGuard } from '../auth/org-setup-complete.guard';
import { AllowOrgTypes, OrgVerifiedGuard } from '../auth/org-verified.guard';
import { ProjectsService } from './projects.service';
import { ProjectReportService, reportToCsv } from './project-report.service';
import { AddRoleDto, CreateProjectDto, UpdateProjectDto, UpdateRoleDto } from './projects.dto';

/**
 * Hiring projects — employer orgs only for now (OrgVerifiedGuard's default
 * org type); recruiter client projects are the spec's phase 2. Same guards
 * as JobsController.
 */
@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard, OrgVerifiedGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
// Recruiters run client projects (phase 2); see ProjectsService.
@AllowOrgTypes(OrgType.EMPLOYER, OrgType.STAFFING)
export class ProjectsController {
  constructor(
    private readonly svc: ProjectsService,
    private readonly reports: ProjectReportService,
  ) {}

  @Get()
  list(@Req() req: OrgScopedRequest, @Query('archived') archived?: string) {
    return this.svc.list(req.orgId, archived === '1');
  }

  @Post()
  create(@Req() req: OrgScopedRequest, @Body() dto: CreateProjectDto) {
    return this.svc.create(req.orgId, req.user.sub, dto);
  }

  /** Project report: every role's headcount, pipeline and attention flags (no candidate details). */
  @Get(':id/report')
  report(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.build(req.orgId, id);
  }

  /** The same report as a CSV for Excel or Google Sheets. */
  @Get(':id/report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async reportCsv(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const report = await this.reports.build(req.orgId, id);
    const slug = report.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-report-${report.generatedAt.toISOString().slice(0, 10)}.csv"`);
    // BOM so Excel reads the file as UTF-8 (₹, accented names).
    res.send('\uFEFF' + reportToCsv(report));
  }

  @Get(':id')
  get(@Req() req: OrgScopedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.get(req.orgId, id);
  }

  @Patch(':id')
  update(@Req() req: OrgScopedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateProjectDto) {
    return this.svc.update(req.orgId, id, dto);
  }

  @Post(':id/roles')
  addRole(@Req() req: OrgScopedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AddRoleDto) {
    return this.svc.addRole(req.orgId, id, dto);
  }

  @Patch(':id/roles/:roleId')
  updateRole(
    @Req() req: OrgScopedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.svc.updateRole(req.orgId, id, roleId, dto);
  }

  @Delete(':id/roles/:roleId')
  removeRole(
    @Req() req: OrgScopedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
  ) {
    return this.svc.removeRole(req.orgId, id, roleId);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@Req() req: OrgScopedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.publishReady(req.orgId, id);
  }
}
