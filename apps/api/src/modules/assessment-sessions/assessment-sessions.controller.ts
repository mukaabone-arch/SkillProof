import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AssessmentSession } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssessmentSessionsService } from './assessment-sessions.service';
import { PostSessionTurnDto } from './assessment-sessions.dto';

/** Candidate-facing session summary — never includes ladderState. */
function toSessionResponse(session: AssessmentSession) {
  return {
    id: session.id,
    status: session.status,
    pinnedBrief: session.pinnedBrief,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
  };
}

@Controller('assessment-sessions')
@UseGuards(JwtAuthGuard)
export class AssessmentSessionsController {
  constructor(private readonly svc: AssessmentSessionsService) {}

  @Post()
  async create(@Req() req: AuthenticatedRequest) {
    const { session, turns } = await this.svc.createSession(req.user.sub);
    return { session: toSessionResponse(session), turns };
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { session, turns } = await this.svc.getSession(req.user.sub, id);
    return { session: toSessionResponse(session), turns };
  }

  @Post(':id/turns')
  async postTurn(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: PostSessionTurnDto) {
    const { candidateTurn, assessorTurn, session } = await this.svc.postTurn(req.user.sub, id, dto.content);
    return { candidateTurn, assessorTurn, session: toSessionResponse(session) };
  }

  @Post(':id/resume')
  async resume(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { turn, session } = await this.svc.resume(req.user.sub, id);
    return { turn, session: toSessionResponse(session) };
  }
}
