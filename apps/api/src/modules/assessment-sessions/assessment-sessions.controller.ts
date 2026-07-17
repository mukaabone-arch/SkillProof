import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AssessmentSession, Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AssessmentSessionsService, computeProgress, IDLE_TIMEOUT_MINUTES } from './assessment-sessions.service';
import { LadderState } from './assessor.service';
import { ScoringService } from './scoring.service';
import { ReviewService } from './review.service';
import { DISCUSSION_DURATION_MINS } from './rag-systems-l2.rubric';
import {
  DisputeClaimDto,
  LiveFeedbackVoteDto,
  PostSessionTurnDto,
  ResolveDisputeDto,
  ReviewClaimDto,
  SessionDecisionDto,
} from './assessment-sessions.dto';

/**
 * Candidate-facing session summary — never includes ladderState itself,
 * only the numeric progress derived from it (see computeProgress — just a
 * count, never which topic). elapsedSeconds is a snapshot (see
 * AssessmentSessionsService.computeElapsedSeconds); idleTimeoutMinutes and
 * advertisedDurationMinutes are the real config/rubric values the server
 * actually uses, surfaced so client copy/countdowns never hardcode a guess
 * that could drift out of sync.
 */
function toSessionResponse(session: AssessmentSession, elapsedSeconds: number) {
  return {
    id: session.id,
    status: session.status,
    pinnedBrief: session.pinnedBrief,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    elapsedSeconds,
    idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
    advertisedDurationMinutes: DISCUSSION_DURATION_MINS,
    progress: computeProgress(session.ladderState as unknown as LadderState),
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
    const { session, turns, claimFeedback } = await this.svc.createSession(req.user.sub);
    const elapsedSeconds = await this.svc.computeElapsedSeconds(session.id, session.startedAt);
    return { session: toSessionResponse(session, elapsedSeconds), turns, claimFeedback };
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

  /**
   * Also must be declared before GET ':id', same reason as review-queue
   * above. Lets the catalog/pre-session pages ask "do I already have a
   * session, and what state is it in" without knowing an id up front.
   */
  @Get('mine')
  mine(@Req() req: AuthenticatedRequest) {
    return this.svc.getMine(req.user.sub);
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { session, turns, claimFeedback } = await this.svc.getSession(req.user.sub, id);
    const elapsedSeconds = await this.svc.computeElapsedSeconds(session.id, session.startedAt);
    return { session: toSessionResponse(session, elapsedSeconds), turns, claimFeedback };
  }

  @Post(':id/turns')
  async postTurn(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: PostSessionTurnDto) {
    const { candidateTurn, assessorTurn, session, liveFeedback } = await this.svc.postTurn(req.user.sub, id, dto.content, dto.signals);
    const elapsedSeconds = await this.svc.computeElapsedSeconds(session.id, session.startedAt);
    return { candidateTurn, assessorTurn, session: toSessionResponse(session, elapsedSeconds), liveFeedback };
  }

  /** Upsertable "was this helpful" vote on one claim's live feedback — 404 if that claim has no feedback yet. */
  @Post(':id/claims/:claimId/feedback-vote')
  voteLiveFeedback(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('claimId') claimId: string,
    @Body() dto: LiveFeedbackVoteDto,
  ) {
    return this.svc.voteLiveFeedback(req.user.sub, id, claimId, dto.helpful);
  }

  @Post(':id/resume')
  async resume(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { turn, session } = await this.svc.resume(req.user.sub, id);
    const elapsedSeconds = await this.svc.computeElapsedSeconds(session.id, session.startedAt);
    return { turn, session: toSessionResponse(session, elapsedSeconds) };
  }

  /** Retries a session stuck in AWAITING_SCORING (scoringError set) — 409 otherwise. */
  @Post(':id/score')
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  async retryScore(@Param('id') id: string) {
    const session = await this.scoring.retryScoring(id);
    const elapsedSeconds = await this.svc.computeElapsedSeconds(session.id, session.startedAt);
    return { session: toSessionResponse(session, elapsedSeconds) };
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

  /** Candidate-scoped, own session only (404 otherwise); 404 until the session is decided. */
  @Get(':id/result')
  getResult(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.getResult(req.user.sub, id);
  }

  /** One dispute per claim — a second attempt on the same claim 409s. Flips the session to DISPUTED. */
  @Post(':id/claims/:claimId/dispute')
  disputeClaim(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('claimId') claimId: string,
    @Body() dto: DisputeClaimDto,
  ) {
    return this.svc.disputeClaim(req.user.sub, id, claimId, dto.body);
  }

  /** Write-once per claim dispute — 409 if already resolved. Reverts the session off DISPUTED once none remain unresolved. */
  @Post(':id/claims/:claimId/dispute/resolve')
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  resolveDispute(@Param('id') id: string, @Param('claimId') claimId: string, @Body() dto: ResolveDisputeDto) {
    return this.svc.resolveDispute(id, claimId, dto.upheld, dto.resolution);
  }
}
