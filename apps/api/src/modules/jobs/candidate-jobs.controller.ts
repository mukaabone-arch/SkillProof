import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CandidateJobsService } from './candidate-jobs.service';
import { BrowseJobsDto } from './candidate-jobs.dto';

/** Candidate-facing job discovery — separate from the employer JobsController above. */
@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class CandidateJobsController {
  constructor(private readonly svc: CandidateJobsService) {}

  @Get('browse')
  browse(@Req() req: AuthenticatedRequest, @Query() dto: BrowseJobsDto) {
    return this.svc.browse(req.user.sub, dto);
  }

  @Get('matched')
  matched(@Req() req: AuthenticatedRequest) {
    return this.svc.matched(req.user.sub);
  }

  @Get('browse/:id')
  browseOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.browseOne(req.user.sub, id);
  }

  @Post(':id/apply')
  apply(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.apply(req.user.sub, id);
  }
}
