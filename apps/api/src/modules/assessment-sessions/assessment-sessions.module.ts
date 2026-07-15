import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssessmentSessionsController } from './assessment-sessions.controller';
import { AssessmentSessionsService } from './assessment-sessions.service';
import { AssessorService } from './assessor.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [AuthModule],
  controllers: [AssessmentSessionsController],
  providers: [AssessmentSessionsService, AssessorService, ScoringService],
})
export class AssessmentSessionsModule {}
