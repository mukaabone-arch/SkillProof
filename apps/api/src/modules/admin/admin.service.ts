import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BulkQuestionItemDto, CreateAssessmentDto, CreateQuestionDto, UpdateAssessmentDto } from './admin.dto';

interface BulkItemErrors {
  index: number;
  errors: string[];
}

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
      data: this.buildQuestionData(assessmentId, dto.text, dto.options, dto.correctIndex, dto.difficulty),
    });
  }

  /**
   * Validates the entire batch before writing anything — a bad item anywhere
   * in the paste fails the whole import with a per-item report instead of
   * half-importing. Rows are created via the exact same data shape as
   * `addQuestion` (buildQuestionData), so bulk and single-question imports
   * are indistinguishable in the DB.
   */
  async bulkAddQuestions(assessmentId: string, body: unknown) {
    await this.getAssessmentOrThrow(assessmentId);

    if (!Array.isArray(body) || body.length === 0) {
      throw new BadRequestException('Expected a non-empty JSON array of question objects.');
    }

    const errorReport: BulkItemErrors[] = [];
    const valid: BulkQuestionItemDto[] = [];

    for (let index = 0; index < body.length; index++) {
      const raw = body[index];
      if (typeof raw !== 'object' || raw === null) {
        errorReport.push({ index, errors: ['Expected a JSON object'] });
        continue;
      }

      const dto = plainToInstance(BulkQuestionItemDto, raw);
      const violations = await validate(dto);
      const messages = violations.flatMap((v) => Object.values(v.constraints ?? {}));

      if (Array.isArray(dto.options) && Number.isInteger(dto.correctIndex) && dto.correctIndex >= dto.options.length) {
        messages.push('correctIndex must reference one of the provided options');
      }

      if (messages.length > 0) {
        errorReport.push({ index, errors: messages });
      } else {
        valid.push(dto);
      }
    }

    if (errorReport.length > 0) {
      throw new BadRequestException({
        message: `${errorReport.length} of ${body.length} question(s) failed validation — nothing was imported.`,
        errors: errorReport,
      });
    }

    const created = await this.prisma.$transaction(
      valid.map((dto) =>
        this.prisma.question.create({
          data: this.buildQuestionData(assessmentId, dto.question, dto.options, dto.correctIndex, dto.difficulty ?? 2),
        }),
      ),
    );

    return { created: created.length };
  }

  /** Single source of truth for the Question row shape — reused by addQuestion and bulkAddQuestions. */
  private buildQuestionData(
    assessmentId: string,
    text: string,
    options: string[],
    correctIndex: number,
    difficulty: number,
  ): Prisma.QuestionCreateInput {
    return {
      assessment: { connect: { id: assessmentId } },
      type: 'MCQ',
      body: { text, options },
      correct: { answer: correctIndex },
      difficulty,
      isLive: true,
    };
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
