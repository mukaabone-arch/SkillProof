import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InterviewQuestionsService } from './interview-questions.service';
import { ListInterviewQuestionsQueryDto, UpdateInterviewQuestionDto } from './interview-questions.dto';

/** Curate the interview-prep question bank without a deploy — list
 * (including inactive rows, so a curator can see what's retired and why)
 * and edit any field. No candidate-facing route on this controller. */
@Controller('admin/interview-questions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PLATFORM_ADMIN)
export class InterviewQuestionsController {
  constructor(private readonly svc: InterviewQuestionsService) {}

  @Get()
  list(@Query() query: ListInterviewQuestionsQueryDto) {
    return this.svc.list(query);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInterviewQuestionDto) {
    return this.svc.update(id, dto);
  }
}
