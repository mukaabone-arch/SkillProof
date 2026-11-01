import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { StaffingService } from './staffing.service';
import { RespondStaffingRequestDto, UpdateAvailabilityDto } from './staffing.dto';

/** The candidate's own side of staffing: opt-in + availability, request inbox, blocked companies. */
@Controller('staffing/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class StaffingCandidateController {
  constructor(private readonly svc: StaffingService) {}

  @Get('availability')
  getAvailability(@Req() req: AuthenticatedRequest) {
    return this.svc.getAvailability(req.user.sub);
  }

  @Put('availability')
  updateAvailability(@Req() req: AuthenticatedRequest, @Body() dto: UpdateAvailabilityDto) {
    return this.svc.updateAvailability(req.user.sub, dto);
  }

  @Post('availability/confirm')
  confirm(@Req() req: AuthenticatedRequest) {
    return this.svc.confirmAvailability(req.user.sub);
  }

  @Get('requests')
  requests(@Req() req: AuthenticatedRequest) {
    return this.svc.listMyRequests(req.user.sub);
  }

  @Post('requests/:id/respond')
  respond(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RespondStaffingRequestDto) {
    return this.svc.respond(req.user.sub, id, dto);
  }

  @Get('blocks')
  blocks(@Req() req: AuthenticatedRequest) {
    return this.svc.listMyBlocks(req.user.sub);
  }

  @Delete('blocks/:orgId')
  unblock(@Req() req: AuthenticatedRequest, @Param('orgId') orgId: string) {
    return this.svc.unblock(req.user.sub, orgId);
  }
}
