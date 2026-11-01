import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileViewsModule } from '../profile-views/profile-views.module';
import { StaffingCandidateController } from './staffing-candidate.controller';
import { StaffingOrgController } from './staffing-org.controller';
import { StaffingService } from './staffing.service';
import { StaffingSubmissionsService } from './staffing-submissions.service';
import { StaffingSubmissionsCandidateController, StaffingSubmissionsOrgController } from './staffing-submissions.controllers';
import { StaffingAvailabilityReminderJob } from './staffing-availability-reminder.job';

@Module({
  imports: [NotificationsModule, AuthModule, ProfileViewsModule],
  controllers: [StaffingSubmissionsOrgController, StaffingSubmissionsCandidateController, StaffingCandidateController, StaffingOrgController],
  providers: [StaffingSubmissionsService, StaffingService, StaffingAvailabilityReminderJob],
})
export class StaffingModule {}
