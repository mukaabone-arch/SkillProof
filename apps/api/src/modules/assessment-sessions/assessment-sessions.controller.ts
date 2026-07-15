import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AssessmentSession, Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AssessmentSessionsService } from './assessment-sessions.service';
import { ScoringService } from './scoring.service';
import { ReviewService } from './review.service';
import { PostSessionTurnDto, ReviewClaimDto, SessionDecisionDto } from './assessment-sessions.dto';

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
  constructor(
    private readonly svc: AssessmentSessionsService,
    private readonly scoring: ScoringService,
    private readonly review: ReviewService,
  ) {}

  @Post()
  async create(@Req() req: AuthenticatedRequest) {
    const { session, turns } = await this.svc.createSession(req.user.sub);
    return { session: toSessionResponse(session), turns };
  }

  /**
   * Must be declared before GET ':id' — Nest matches routes in declaration
   * order, and ':id' would otherwise swallow the literal "review-queue"
   * path segment as an id.
   */
  @Get('review-queue')
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  reviewQueue() {
    return this.scoring.getReviewQueue();
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

  /** Retries a session stuck in AWAITING_SCORING (scoringError set) — 409 otherwise. */
  @Post(':id/score')
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  async retryScore(@Param('id') id: string) {
    const session = await this.scoring.retryScoring(id);
    return { session: toSessionResponse(session) };
  }

  /** The reviewer's case payload — anti-anchoring enforced inside ReviewService, not here. */
  @Get(':id/review')
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  getReviewCase(@Param('id') id: string) {
    return this.review.getReviewCase(id);
  }

  /** Write-once per claim — 409 if already reviewed. Reveals the model's verdict/reason only in this response. */
  @Post(':id/claims/:claimId/review')
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  reviewClaim(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('claimId') claimId: string,
    @Body() dto: ReviewClaimDto,
  ) {
    return this.review.reviewClaim(id, claimId, req.user.sub, dto.verdict, dto.note);
  }

  /** 409 unless every claim has a reviewerVerdict. ISSUE mints a badge through the existing Badge/SkillClaim mechanism. */
  @Post(':id/decision')
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  decide(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: SessionDecisionDto) {
    return this.review.decide(id, req.user.sub, dto.decision, dto.note);
  }
}
