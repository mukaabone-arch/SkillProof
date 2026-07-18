import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InterviewsController } from './interviews.controller';
import { InterviewsService } from './interviews.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [InterviewsController],
  providers: [InterviewsService],
})
export class InterviewsModule {}
