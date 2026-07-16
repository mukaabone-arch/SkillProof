import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BadgesModule } from '../badges/badges.module';
import { AssessmentSessionsController } from './assessment-sessions.controller';
import { AssessmentSessionsService } from './assessment-sessions.service';
import { AssessorService } from './assessor.service';
import { ScoringService } from './scoring.service';
import { ReviewService } from './review.service';

@Module({
  imports: [AuthModule, BadgesModule],
  controllers: [AssessmentSessionsController],
  providers: [AssessmentSessionsService, AssessorService, ScoringService, ReviewService],
  // AssessmentSessionsService is consumed by AssessmentsModule to compose
  // the skill-grouped catalog endpoint (discussion-format retake/action
  // state folded in alongside MCQ data) — see AssessmentsService.getCatalog.
  exports: [AssessmentSessionsService],
})
export class AssessmentSessionsModule {}
