import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { ShortlistService } from './shortlist.service';
import { ShortlistPipelineService } from './shortlist-pipeline.service';
import { AddShortlistEntryDto, ListShortlistDto, UpdateShortlistEntryDto } from './shortlist.dto';
import { AddRoundDto, InviteDto, OutcomeDto, RejectDto, UpdateRoundDto } from './shortlist-pipeline.dto';

@Controller('shortlist')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class ShortlistController {
  constructor(
    private readonly svc: ShortlistService,
    private readonly pipeline: ShortlistPipelineService,
  ) {}

  @Post()
  add(@Req() req: OrgScopedRequest, @Body() dto: AddShortlistEntryDto) {
    return this.svc.add(req.orgId, req.user.sub, dto);
  }

  @Get()
  list(@Req() req: OrgScopedRequest, @Query() dto: ListShortlistDto) {
    return this.svc.list(req.orgId, dto.jobId, dto.stage);
  }

  @Patch(':id')
  update(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: UpdateShortlistEntryDto) {
    return this.svc.update(req.orgId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.svc.remove(req.orgId, id);
  }

  @Post(':id/invite')
  invite(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: InviteDto) {
    return this.pipeline.invite(req.orgId, id, dto);
  }

  @Post(':id/rounds')
  addRound(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: AddRoundDto) {
    return this.pipeline.addRound(req.orgId, id, dto);
  }

  @Patch(':id/rounds/:roundId')
  updateRound(
    @Req() req: OrgScopedRequest,
    @Param('id') id: string,
    @Param('roundId') roundId: string,
    @Body() dto: UpdateRoundDto,
  ) {
    return this.pipeline.updateRound(req.orgId, id, roundId, dto);
  }

  @Post(':id/offer')
  offer(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    return this.pipeline.offer(req.orgId, id);
  }

  @Post(':id/outcome')
  outcome(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: OutcomeDto) {
    return this.pipeline.outcome(req.orgId, id, dto);
  }

  @Post(':id/reject')
  reject(@Req() req: OrgScopedRequest, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.pipeline.reject(req.orgId, req.user.sub, id, dto);
  }
}
