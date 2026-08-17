import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';
import { OrgMembersController } from './org-members.controller';
import { OrgMembersService } from './org-members.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [OrgsController, OrgMembersController],
  providers: [OrgMembersService, OrgsService],
})
export class OrgsModule {}
