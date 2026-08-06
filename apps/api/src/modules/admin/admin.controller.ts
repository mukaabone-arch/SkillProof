import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminService } from './admin.service';
import { AccountService } from '../account/account.service';
import { DataExportService } from '../data-export/data-export.service';
import { ListExportRequestsQueryDto } from '../data-export/data-export.dto';
import {
  CreateAssessmentDto,
  CreateQuestionDto,
  ListAccountActionsQueryDto,
  ListAttemptsQueryDto,
  ReviewAttemptDto,
  SetSubscriptionDto,
  UpdateAssessmentDto,
} from './admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PLATFORM_ADMIN)
export class AdminController {
  constructor(
    private readonly svc: AdminService,
    private readonly account: AccountService,
    private readonly dataExport: DataExportService,
  ) {}

  /** Compliance Center / Privacy Requests — see AccountService.listActionsForAdmin's own doc comment for exactly what each derived field does and doesn't claim. */
  @Get('account-actions')
  listAccountActions(@Query() query: ListAccountActionsQueryDto) {
    return this.account.listActionsForAdmin(query);
  }

  @Get('assessments')
  list() {
    return this.svc.listAssessments();
  }

  @Post('assessments')
  create(@Body() dto: CreateAssessmentDto) {
    return this.svc.createAssessment(dto);
  }

  @Patch('assessments/:id')
  update(@Param('id') id: string, @Body() dto: UpdateAssessmentDto) {
    return this.svc.updateAssessment(id, dto);
  }

  @Post('assessments/:id/questions')
  addQuestion(@Param('id') id: string, @Body() dto: CreateQuestionDto) {
    return this.svc.addQuestion(id, dto);
  }

  /** Body is a bare JSON array, not a wrapped object — validated item-by-item in the service. */
  @Post('assessments/:id/questions/bulk')
  bulkAddQuestions(@Param('id') id: string, @Body() body: unknown) {
    return this.svc.bulkAddQuestions(id, body);
  }

  @Delete('questions/:id')
  removeQuestion(@Param('id') id: string) {
    return this.svc.removeQuestion(id);
  }

  /** Review queue — GET /admin/attempts?status=FLAGGED lists attempts needing a decision. */
  @Get('attempts')
  listAttempts(@Query() query: ListAttemptsQueryDto) {
    return this.svc.listAttemptsForReview(query);
  }

  /** Admin-only attempt review — includes integrity data never shown to the candidate. */
  @Get('attempts/:id')
  getAttempt(@Param('id') id: string) {
    return this.svc.getAttemptForReview(id);
  }

  /** The only path that can invalidate an attempt/badge — never automatic. */
  @Patch('attempts/:id/review')
  reviewAttempt(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReviewAttemptDto,
  ) {
    return this.svc.reviewAttempt(id, req.user.sub, dto);
  }

  /** Foundation work for testing entitlements before any payment provider exists — see EntitlementsModule's README. */
  @Post('candidates/:candidateProfileId/subscription')
  setSubscription(@Param('candidateProfileId') candidateProfileId: string, @Body() dto: SetSubscriptionDto) {
    return this.svc.setSubscription(candidateProfileId, dto);
  }

  /** Compliance Center / Data Exports — status and timestamps only, never the exported content. See DataExportService.listForAdmin's own doc comment. */
  @Get('export-requests')
  listExportRequests(@Req() req: AuthenticatedRequest, @Query() query: ListExportRequestsQueryDto) {
    return this.dataExport.listForAdmin(req.user.sub, query);
  }

  /** Resets a FAILED export back to REQUESTED so the generation sweep retries it — the only write this admin view can make. */
  @Post('export-requests/:id/retry')
  retryExportRequest(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.dataExport.retry(req.user.sub, id);
  }
}
