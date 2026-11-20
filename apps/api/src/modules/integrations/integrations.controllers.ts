import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { OrgType, Role, StaffingSubmissionStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { OrgSetupCompleteGuard } from '../auth/org-setup-complete.guard';
import { AllowOrgTypes, OrgVerifiedGuard } from '../auth/org-verified.guard';
import { IntegrationsService } from './integrations.service';
import { ApiV1Service, ListQuery } from './api-v1.service';
import { ApiKeyGuard, ApiKeyRequest } from './api-key.guard';
import { CreateApiKeyDto, CreateWebhookDto, PipelineActionDto, SubmissionStatusDto, UpdateWebhookDto } from './integrations.dto';

/** Settings → Integrations. Admins manage webhooks and keys; every member can download a candidate package. */
@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard, OrgVerifiedGuard)
@Roles(Role.EMPLOYER_ADMIN)
@AllowOrgTypes(OrgType.EMPLOYER, OrgType.STAFFING)
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get()
  overview(@Req() req: OrgScopedRequest) {
    return this.svc.overview(req.orgId);
  }

  @Post('webhooks')
  createWebhook(@Req() req: OrgScopedRequest, @Body() dto: CreateWebhookDto) {
    return this.svc.createWebhook(req.orgId, req.user.sub, dto);
  }

  @Patch('webhooks/:id')
  updateWebhook(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWebhookDto) {
    return this.svc.updateWebhook(req.orgId, id, dto);
  }

  @Delete('webhooks/:id')
  deleteWebhook(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteWebhook(req.orgId, id);
  }

  @Post('webhooks/:id/rotate-secret')
  rotate(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.rotateSecret(req.orgId, id);
  }

  @Post('webhooks/:id/test')
  test(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.testWebhook(req.orgId, id);
  }

  @Get('webhooks/:id/deliveries')
  deliveries(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deliveries(req.orgId, id);
  }

  @Post('deliveries/:id/redeliver')
  redeliver(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.redeliver(req.orgId, id);
  }

  @Post('api-keys')
  createKey(@Req() req: OrgScopedRequest, @Body() dto: CreateApiKeyDto) {
    return this.svc.createApiKey(req.orgId, req.user.sub, dto.name);
  }

  @Delete('api-keys/:id')
  revokeKey(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeApiKey(req.orgId, id);
  }

  /** "Download for ATS": the candidate package as a JSON file. Any member, for candidates the org already works with. */
  @Get('candidates/:id/package')
  @Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
  async candidatePackage(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const pkg = await this.svc.candidatePackage(req.orgId, id);
    const name = (pkg.name ?? pkg.ref).replace(/[^\w \-]+/g, '').trim().replace(/\s+/g, '-') || 'candidate';
    return new StreamableFile(Buffer.from(JSON.stringify(pkg, null, 2)), {
      type: 'application/json',
      disposition: `attachment; filename="myambii-${name}.json"`,
    });
  }
}

/** Public API v1, authenticated with an org API key (see ApiKeyGuard and the /developers page). */
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class ApiV1Controller {
  constructor(private readonly svc: ApiV1Service) {}

  @Get('jobs')
  jobs(@Req() req: ApiKeyRequest, @Query() q: ListQuery) {
    return this.svc.jobs(req.orgId, q);
  }

  @Get('applicants')
  applicants(@Req() req: ApiKeyRequest, @Query() q: ListQuery) {
    return this.svc.applicants(req.orgId, q);
  }

  @Get('pipeline')
  pipeline(@Req() req: ApiKeyRequest, @Query() q: ListQuery) {
    return this.svc.pipelineList(req.orgId, req.orgType, q);
  }

  @Post('pipeline/:id/actions')
  pipelineAction(@Req() req: ApiKeyRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PipelineActionDto) {
    return this.svc.pipelineAction(req.orgId, req.orgType, req.apiKeyUserId, id, dto);
  }

  @Post('submissions/:id/status')
  submissionStatus(@Req() req: ApiKeyRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmissionStatusDto) {
    return this.svc.submissionStatus(req.orgId, req.orgType, id, dto.status as StaffingSubmissionStatus);
  }

  @Get('candidates/:id')
  candidate(@Req() req: ApiKeyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.candidate(req.orgId, req.orgType, id);
  }

  @Get('candidates/:id/resume')
  @Header('Content-Type', 'application/pdf')
  async resume(@Req() req: ApiKeyRequest, @Param('id', ParseUUIDPipe) id: string) {
    const { buffer, filename } = await this.svc.resume(req.orgId, req.orgType, id);
    return new StreamableFile(buffer, { disposition: `attachment; filename="${filename}"` });
  }
}
