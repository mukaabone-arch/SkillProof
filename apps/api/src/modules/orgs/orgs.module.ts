import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobsModule } from '../jobs/jobs.module';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';
import { OrgMembersController } from './org-members.controller';
import { OrgMembersService } from './org-members.service';

@Module({
  // JobsModule, for JobsService.update — OrgsService.deactivate reuses its
  // exact LIVE->CLOSED / JOB_UNPUBLISHED path rather than duplicating it.
  imports: [AuthModule, NotificationsModule, JobsModule],
  controllers: [OrgsController, OrgMembersController],
  providers: [OrgMembersService, OrgsService],
})
export class OrgsModule {}
