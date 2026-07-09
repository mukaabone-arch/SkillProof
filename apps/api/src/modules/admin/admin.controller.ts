import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminService } from './admin.service';
import {
  CreateAssessmentDto,
  CreateQuestionDto,
  ListAttemptsQueryDto,
  ReviewAttemptDto,
  UpdateAssessmentDto,
} from './admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PLATFORM_ADMIN)
export class AdminController {
  constructor(private readonly svc: AdminService) {}

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
}
