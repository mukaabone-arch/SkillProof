import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InterviewsService } from './interviews.service';
import { RespondInviteDto, RespondOfferDto } from './interviews.dto';
import { UpdatePrepChecklistDto } from './interview-prep.dto';

/** Candidate-facing pipeline view — the employer side of the same data lives in ShortlistController/ShortlistPipelineService. */
@Controller('interviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class InterviewsController {
  constructor(private readonly svc: InterviewsService) {}

  @Get('mine')
  mine(@Req() req: AuthenticatedRequest) {
    return this.svc.listMine(req.user.sub);
  }

  /** Per-interview prep plan — own entries only (404/403 as getOwnedEntry). */
  @Get(':id/prep')
  prep(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.getPrep(req.user.sub, id);
  }

  @Put(':id/prep/checklist')
  prepChecklist(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdatePrepChecklistDto) {
    return this.svc.updatePrepChecklist(req.user.sub, id, dto.done);
  }

  @Post(':id/respond-invite')
  respondInvite(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RespondInviteDto) {
    return this.svc.respondInvite(req.user.sub, id, dto);
  }

  @Post(':id/respond-offer')
  respondOffer(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RespondOfferDto) {
    return this.svc.respondOffer(req.user.sub, id, dto);
  }
}
