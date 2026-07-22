import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfileViewsModule } from '../profile-views/profile-views.module';
import { ShortlistController } from './shortlist.controller';
import { ShortlistService } from './shortlist.service';
import { ShortlistPipelineService } from './shortlist-pipeline.service';

@Module({
  imports: [AuthModule, NotificationsModule, ProfileViewsModule],
  controllers: [ShortlistController],
  providers: [ShortlistService, ShortlistPipelineService],
})
export class ShortlistModule {}
