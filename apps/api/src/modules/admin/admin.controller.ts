import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminService } from './admin.service';
import { CreateAssessmentDto, CreateQuestionDto, UpdateAssessmentDto } from './admin.dto';

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

  @Delete('questions/:id')
  removeQuestion(@Param('id') id: string) {
    return this.svc.removeQuestion(id);
  }
}
