import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { InterviewSession, Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EntitlementGuard } from '../entitlements/entitlement.guard';
import { RequiresEntitlement } from '../entitlements/requires-entitlement.decorator';
import { computeProgress, InterviewSessionsService } from './interview-sessions.service';
import { InterviewPhaseState } from './interview-orchestrator';
import { CreateInterviewSessionDto, PostInterviewTurnDto } from './interview-sessions.dto';

/**
 * Candidate-facing shape of an InterviewSession — phaseState is never
 * exposed raw (see this feature's own "session state lives server-side"
 * requirement); phase name + a coarse progress count is all a candidate
 * ever sees of it.
 */
function toSessionResponse(session: InterviewSession) {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    progress: computeProgress(session.phaseState as unknown as InterviewPhaseState),
  };
}

@Controller('interview-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class InterviewSessionsController {
  constructor(private readonly svc: InterviewSessionsService) {}

  @Post()
  @UseGuards(EntitlementGuard)
  @RequiresEntitlement('interviewPrep')
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateInterviewSessionDto) {
    const { session, turns } = await this.svc.createSession(req.user.sub, dto.applicationId);
    return { session: toSessionResponse(session), turns };
  }

  /** Must be declared before GET ':id' — Nest matches routes in
   * declaration order, and ':id' would otherwise swallow "mine". */
  @Get('mine')
  mine(@Req() req: AuthenticatedRequest) {
    return this.svc.getMine(req.user.sub);
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { session, turns } = await this.svc.getSession(req.user.sub, id);
    return { session: toSessionResponse(session), turns };
  }

  @Post(':id/turns')
  async postTurn(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: PostInterviewTurnDto) {
    const { candidateTurn, coachTurn, session } = await this.svc.postTurn(req.user.sub, id, dto.content);
    return { candidateTurn, coachTurn, session: toSessionResponse(session) };
  }

  @Post(':id/resume')
  async resume(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { turn, session } = await this.svc.resume(req.user.sub, id);
    return { turn, session: toSessionResponse(session) };
  }

  /** Candidate-scoped, own session only (404 otherwise); 404 until feedback has finished generating. */
  @Get(':id/result')
  getResult(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.getResult(req.user.sub, id);
  }

  /** Retries a session stuck in AWAITING_FEEDBACK (feedbackError set) — 409 otherwise. No admin review step exists for this coaching feature, so this is candidate-triggerable on their own session, unlike the assessment module's admin-only retry-score. */
  @Post(':id/feedback/retry')
  async retryFeedback(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const session = await this.svc.retryFeedback(req.user.sub, id);
    return { session: toSessionResponse(session) };
  }
}
