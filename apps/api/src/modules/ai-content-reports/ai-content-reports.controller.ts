import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AiContentReportStatus, Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiContentReportsService } from './ai-content-reports.service';
import { CreateAiContentReportDto, ReviewAiContentReportDto } from './ai-content-reports.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AiContentReportsController {
  constructor(private readonly svc: AiContentReportsService) {}

  /** Candidate: report an AI response from their own session. */
  @Post('ai-content-reports')
  @HttpCode(200)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateAiContentReportDto) {
    return this.svc.create(req.user.sub, dto);
  }

  /** Admin queue — ?status=OPEN|REVIEWED, or all when omitted. */
  @Get('admin/ai-content-reports')
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  list(@Query('status') status?: string) {
    if (status && !(Object.values(AiContentReportStatus) as string[]).includes(status)) {
      throw new BadRequestException('Unknown status.');
    }
    return this.svc.list(status as AiContentReportStatus | undefined);
  }

  @Post('admin/ai-content-reports/:id/review')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.PLATFORM_ADMIN)
  review(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ReviewAiContentReportDto) {
    return this.svc.markReviewed(id, req.user.sub, dto.resolutionNote);
  }
}
