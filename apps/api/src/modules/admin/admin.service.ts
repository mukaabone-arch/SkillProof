import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssessmentDto, CreateQuestionDto, UpdateAssessmentDto } from './admin.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  listAssessments() {
    return this.prisma.assessment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        skill: { include: { domain: true } },
        _count: { select: { questions: { where: { isLive: true } } } },
      },
    });
  }

  createAssessment(dto: CreateAssessmentDto) {
    return this.prisma.assessment.create({ data: dto });
  }

  async updateAssessment(id: string, dto: UpdateAssessmentDto) {
    await this.getAssessmentOrThrow(id);
    return this.prisma.assessment.update({ where: { id }, data: dto });
  }

  async addQuestion(assessmentId: string, dto: CreateQuestionDto) {
    await this.getAssessmentOrThrow(assessmentId);
    if (dto.correctIndex >= dto.options.length) {
      throw new BadRequestException('correctIndex must reference one of the provided options');
    }

    return this.prisma.question.create({
      data: {
        assessmentId,
        type: 'MCQ',
        body: { text: dto.text, options: dto.options },
        correct: { answer: dto.correctIndex },
        difficulty: dto.difficulty,
        isLive: true,
      },
    });
  }

  async removeQuestion(id: string) {
    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) throw new NotFoundException('Question not found');
    return this.prisma.question.update({ where: { id }, data: { isLive: false } });
  }

  private async getAssessmentOrThrow(id: string) {
    const assessment = await this.prisma.assessment.findUnique({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    return assessment;
  }
}
