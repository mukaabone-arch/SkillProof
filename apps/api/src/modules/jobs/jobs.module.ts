import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { EmployerCandidateAccessModule } from '../access/employer-candidate-access.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { BadgesModule } from '../badges/badges.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { MatchingService } from './matching.service';
import { CandidateJobsController } from './candidate-jobs.controller';
import { CandidateJobsService } from './candidate-jobs.service';
import { MatchDigestService } from './match-digest.service';
import { LocationsModule } from '../locations/locations.module';
import { JobImportController } from './import/job-import.controller';
import { JobImportService } from './import/job-import.service';

@Module({
  imports: [AuthModule, LlmModule, NotificationsModule, ProfilesModule, EmployerCandidateAccessModule, EntitlementsModule, BadgesModule, LocationsModule],
  // JobImportController first: its literal 'jobs/import/…' paths must win over JobsController's ':id' routes.
  controllers: [JobImportController, JobsController, CandidateJobsController],
  providers: [JobsService, MatchingService, CandidateJobsService, MatchDigestService, JobImportService],
  exports: [JobsService, CandidateJobsService, JobImportService],
})
export class JobsModule {}
