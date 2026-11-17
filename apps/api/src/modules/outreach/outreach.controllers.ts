import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { OrgType, OutreachCampaignStatus, Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { OrgSetupCompleteGuard } from '../auth/org-setup-complete.guard';
import { AllowOrgTypes, OrgVerifiedGuard } from '../auth/org-verified.guard';
import { OutreachService } from './outreach.service';
import { OutreachCandidateService } from './outreach-candidate.service';
import {
  CreateOutreachCampaignDto,
  RespondOutreachDto,
  SendOutreachDto,
  SetCampaignStatusDto,
  UnsubscribeOutreachDto,
  UpdateOutreachMessageDto,
  UpdateOutreachPreferencesDto,
} from './outreach.dto';

/** Employers and recruiters: AI sourcing campaigns, one per job. */
@Controller('outreach/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard, OrgVerifiedGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
@AllowOrgTypes(OrgType.EMPLOYER, OrgType.STAFFING)
export class OutreachOrgController {
  constructor(private readonly svc: OutreachService) {}

  @Get()
  list(@Req() req: OrgScopedRequest) {
    return this.svc.listCampaigns(req.orgId);
  }

  @Post()
  create(@Req() req: OrgScopedRequest, @Body() dto: CreateOutreachCampaignDto) {
    return this.svc.createCampaign(req.orgId, req.user.sub, dto.jobId);
  }

  @Get(':id')
  get(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getCampaign(req.orgId, req.user.sub, id);
  }

  @Post(':id/find-more')
  findMore(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findMore(req.orgId, req.user.sub, id);
  }

  @Patch(':id/messages/:messageId')
  updateMessage(
    @Req() req: OrgScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UpdateOutreachMessageDto,
  ) {
    return this.svc.updateMessage(req.orgId, req.user.sub, id, messageId, dto);
  }

  @Post(':id/send')
  @HttpCode(200)
  send(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendOutreachDto) {
    return this.svc.send(req.orgId, req.user.sub, id, dto.messageIds);
  }

  @Post(':id/status')
  @HttpCode(200)
  setStatus(@Req() req: OrgScopedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCampaignStatusDto) {
    return this.svc.setStatus(req.orgId, req.user.sub, id, dto.status as OutreachCampaignStatus);
  }
}

/** Candidates: the Opportunities inbox and who may contact them. */
@Controller('outreach/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class OutreachCandidateController {
  constructor(private readonly svc: OutreachCandidateService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.svc.listMine(req.user.sub);
  }

  @Get('preferences')
  preferences(@Req() req: AuthenticatedRequest) {
    return this.svc.getPreferences(req.user.sub);
  }

  @Put('preferences')
  updatePreferences(@Req() req: AuthenticatedRequest, @Body() dto: UpdateOutreachPreferencesDto) {
    return this.svc.updatePreferences(req.user.sub, dto);
  }

  /** Same as PUT — the mobile app's ApiClient has no put(). */
  @Patch('preferences')
  patchPreferences(@Req() req: AuthenticatedRequest, @Body() dto: UpdateOutreachPreferencesDto) {
    return this.svc.updatePreferences(req.user.sub, dto);
  }

  @Post(':id/respond')
  @HttpCode(200)
  respond(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondOutreachDto) {
    return this.svc.respond(req.user.sub, id, dto);
  }
}

/** The signed-out "Stop recruiter messages" link in outreach emails (HMAC token, see outreach.util.ts). */
@Controller('outreach')
export class OutreachPublicController {
  constructor(private readonly svc: OutreachCandidateService) {}

  @Post('unsubscribe')
  @HttpCode(200)
  unsubscribe(@Body() dto: UnsubscribeOutreachDto) {
    return this.svc.unsubscribe(dto.u, dto.t);
  }
}
