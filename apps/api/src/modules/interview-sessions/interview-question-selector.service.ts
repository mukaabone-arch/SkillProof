import { Injectable } from '@nestjs/common';
import { InterviewQuestion, InterviewQuestionCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Picks one active bank question for a category, never repeating a
 * question already asked this session. When the session is grounded in a
 * real application (see InterviewSessionsService), prefers a
 * isCompanyGrounded question in that category if one exists — this is a
 * genuine, working mechanism even though no bank rows are flagged that way
 * yet (see InterviewQuestion's own doc comment on isCompanyGrounded), so it
 * starts working automatically the day the product owner adds one, with no
 * code change here. Falls back to any active question in the category
 * otherwise — which is every case today.
 */
@Injectable()
export class InterviewQuestionSelectorService {
  constructor(private readonly prisma: PrismaService) {}

  async pickQuestion(
    category: InterviewQuestionCategory,
    excludeIds: string[],
    grounded: boolean,
  ): Promise<InterviewQuestion | null> {
    const baseWhere = { category, active: true, id: { notIn: excludeIds } };

    if (grounded) {
      const groundedCandidates = await this.prisma.interviewQuestion.findMany({
        where: { ...baseWhere, isCompanyGrounded: true },
      });
      if (groundedCandidates.length > 0) return this.pickRandom(groundedCandidates);
    }

    const candidates = await this.prisma.interviewQuestion.findMany({ where: baseWhere });
    if (candidates.length === 0) return null;
    return this.pickRandom(candidates);
  }

  private pickRandom(questions: InterviewQuestion[]): InterviewQuestion {
    return questions[Math.floor(Math.random() * questions.length)];
  }
}
