import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShortlistController } from './shortlist.controller';
import { ShortlistService } from './shortlist.service';
import { ShortlistPipelineService } from './shortlist-pipeline.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ShortlistController],
  providers: [ShortlistService, ShortlistPipelineService],
})
export class ShortlistModule {}
