import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { ShortlistService } from './shortlist.service';
import { AddShortlistEntryDto, ListShortlistDto, UpdateShortlistEntryDto } from './shortlist.dto';

@Controller('shortlist')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class ShortlistController {
  constructor(private readonly svc: ShortlistService) {}

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
}
