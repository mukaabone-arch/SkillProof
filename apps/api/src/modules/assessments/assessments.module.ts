import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BadgesModule } from '../badges/badges.module';
import { AssessmentSessionsModule } from '../assessment-sessions/assessment-sessions.module';
import { JobsModule } from '../jobs/jobs.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';

@Module({
  imports: [AuthModule, BadgesModule, AssessmentSessionsModule, JobsModule, EntitlementsModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  // AssessmentsService.startAttempt is consumed by AssessmentRequestsService
  // (employer-triggered assessments) via its skipLevelAndRetakeChecks option
  // — see that method's own doc comment.
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
