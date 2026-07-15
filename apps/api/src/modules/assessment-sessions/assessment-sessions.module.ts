import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssessmentSessionsController } from './assessment-sessions.controller';
import { AssessmentSessionsService } from './assessment-sessions.service';
import { AssessorService } from './assessor.service';
import { ScoringService } from './scoring.service';
import { ReviewService } from './review.service';

@Module({
  imports: [AuthModule],
  controllers: [AssessmentSessionsController],
  providers: [AssessmentSessionsService, AssessorService, ScoringService, ReviewService],
})
export class AssessmentSessionsModule {}
