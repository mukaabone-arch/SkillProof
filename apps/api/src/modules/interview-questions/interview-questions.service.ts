import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListInterviewQuestionsQueryDto, UpdateInterviewQuestionDto } from './interview-questions.dto';

/**
 * Admin curation of the interview-prep question bank — list and edit only.
 * No candidate-facing read path and no session/scoring logic lives here;
 * see InterviewQuestion's own doc comment in schema.prisma.
 */
@Injectable()
export class InterviewQuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ListInterviewQuestionsQueryDto) {
    return this.prisma.interviewQuestion.findMany({
      where: {
        ...(query.category ? { category: query.category } : {}),
        ...(query.active !== undefined ? { active: query.active } : {}),
      },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async update(id: string, dto: UpdateInterviewQuestionDto) {
    const existing = await this.prisma.interviewQuestion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Interview question not found');

    return this.prisma.interviewQuestion.update({
      where: { id },
      data: {
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.whatToLookFor !== undefined ? { whatToLookFor: dto.whatToLookFor } : {}),
        // Stored as Json — see schema.prisma's own note on why (room for
        // future shape changes without a migration). class-validator has
        // already confirmed it's a well-formed {situation,task,action,result}
        // object by the time it reaches here.
        ...(dto.expectedElements !== undefined ? { expectedElements: dto.expectedElements as object } : {}),
        ...(dto.followUpProbes !== undefined ? { followUpProbes: dto.followUpProbes } : {}),
        ...(dto.isCompanyGrounded !== undefined ? { isCompanyGrounded: dto.isCompanyGrounded } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }
}
