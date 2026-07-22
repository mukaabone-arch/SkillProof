import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { EntitlementGuard } from '../entitlements/entitlement.guard';
import { RequiresEntitlement } from '../entitlements/requires-entitlement.decorator';
import { AssessmentsService } from './assessments.service';
import { RecordIntegrityEventDto } from './assessments.dto';

@Controller()
export class AssessmentsController {
  constructor(private readonly svc: AssessmentsService) {}

  @Get('assessments')
  list() {
    return this.svc.listLive();
  }

  /**
   * Must be declared before any GET 'assessments/:id'-shaped route (none
   * exist today, but keep this first if one's ever added) — same
   * literal-segment-before-param-route ordering rule used elsewhere in this
   * codebase (see AssessmentSessionsController's review-queue/mine comments).
   */
  @Get('assessments/catalog')
  @UseGuards(JwtAuthGuard)
  catalog(@Req() req: AuthenticatedRequest) {
    return this.svc.getCatalog(req.user.sub);
  }

  /**
   * Mobile-only simplified projection of the same catalog — one card per
   * not-yet-fully-earned skill instead of the full level×format grid. Must
   * stay before any GET 'assessments/:id'-shaped route for the same reason
   * as 'assessments/catalog' above (none exist today).
   */
  @Get('assessments/catalog/summary')
  @UseGuards(JwtAuthGuard)
  catalogSummary(@Req() req: AuthenticatedRequest) {
    return this.svc.getCandidateSummary(req.user.sub);
  }

  @Post('assessments/:id/attempts')
  @UseGuards(JwtAuthGuard, EntitlementGuard)
  @RequiresEntitlement('assessments')
  start(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.startAttempt(req.user.sub, id);
  }

  @Get('attempts/:id/questions')
  @UseGuards(JwtAuthGuard)
  questions(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.getQuestions(req.user.sub, id);
  }

  @Post('attempts/:id/answers')
  @UseGuards(JwtAuthGuard)
  answer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { questionId: string; answer: unknown },
  ) {
    return this.svc.submitAnswer(req.user.sub, id, body.questionId, body.answer);
  }

  @Post('attempts/:id/submit')
  @UseGuards(JwtAuthGuard)
  submit(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.submit(req.user.sub, id);
  }

  @Get('attempts/:id/result')
  @UseGuards(JwtAuthGuard)
  result(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.getResult(req.user.sub, id);
  }

  /** Signals only (tab blur, paste, ...) — never surfaced back to the candidate. */
  @Post('attempts/:id/integrity-event')
  @UseGuards(JwtAuthGuard)
  integrityEvent(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RecordIntegrityEventDto,
  ) {
    return this.svc.recordIntegrityEvent(req.user.sub, id, dto);
  }

  /** Public certificate verification page data */
  @Get('badges/verify/:hash')
  verify(@Param('hash') hash: string) {
    return this.svc.verifyBadge(hash);
  }
}
