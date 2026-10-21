import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BadgesModule } from '../badges/badges.module';
import { JobsModule } from '../jobs/jobs.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AssessmentSessionsModule } from '../assessment-sessions/assessment-sessions.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { AssessmentRequestsModule } from '../assessment-requests/assessment-requests.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

/**
 * A leaf module: it only consumes other modules' exported services and
 * nothing imports it, so it can't introduce a circular module dependency.
 */
@Module({
  imports: [
    AuthModule,
    BadgesModule,
    JobsModule,
    AssessmentsModule,
    AssessmentSessionsModule,
    InterviewsModule,
    AssessmentRequestsModule,
  ],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
