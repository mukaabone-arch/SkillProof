import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileViewsModule } from '../profile-views/profile-views.module';
import { StaffingCandidateController } from './staffing-candidate.controller';
import { StaffingOrgController } from './staffing-org.controller';
import { StaffingService } from './staffing.service';

@Module({
  imports: [NotificationsModule, AuthModule, ProfileViewsModule],
  controllers: [StaffingCandidateController, StaffingOrgController],
  providers: [StaffingService],
})
export class StaffingModule {}
