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
import { AssessmentsService } from './assessments.service';
import { RecordIntegrityEventDto } from './assessments.dto';

@Controller()
export class AssessmentsController {
  constructor(private readonly svc: AssessmentsService) {}

  @Get('assessments')
  list() {
    return this.svc.listLive();
  }

  @Post('assessments/:id/attempts')
  @UseGuards(JwtAuthGuard)
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
