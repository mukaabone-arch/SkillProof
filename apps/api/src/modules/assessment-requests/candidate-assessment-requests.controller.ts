import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssessmentRequestsService } from './assessment-requests.service';
import { StartAssessmentRequestLevelDto } from './assessment-requests.dto';

/** Candidate half — invitations list, and starting one level of one (see AssessmentRequestsService.startFromRequest). */
@Controller('assessment-requests/mine')
@UseGuards(JwtAuthGuard)
export class CandidateAssessmentRequestsController {
  constructor(private readonly svc: AssessmentRequestsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.svc.listForCandidate(req.user.sub);
  }

  @Post(':id/start')
  start(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: StartAssessmentRequestLevelDto) {
    return this.svc.startFromRequest(id, dto.level, req.user.sub);
  }
}
