import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { EmployerCandidateAccessModule } from '../access/employer-candidate-access.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { MatchingService } from './matching.service';
import { CandidateJobsController } from './candidate-jobs.controller';
import { CandidateJobsService } from './candidate-jobs.service';
import { MatchDigestService } from './match-digest.service';

@Module({
  imports: [AuthModule, LlmModule, NotificationsModule, ProfilesModule, EmployerCandidateAccessModule, EntitlementsModule],
  controllers: [JobsController, CandidateJobsController],
  providers: [JobsService, MatchingService, CandidateJobsService, MatchDigestService],
  exports: [CandidateJobsService],
})
export class JobsModule {}
