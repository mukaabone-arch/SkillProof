import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssessmentRequestsService } from './assessment-requests.service';

/** Candidate half — invitations list, and starting one (see AssessmentRequestsService.startFromRequest). */
@Controller('assessment-requests/mine')
@UseGuards(JwtAuthGuard)
export class CandidateAssessmentRequestsController {
  constructor(private readonly svc: AssessmentRequestsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.svc.listForCandidate(req.user.sub);
  }

  @Post(':id/start')
  start(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.startFromRequest(id, req.user.sub);
  }
}
