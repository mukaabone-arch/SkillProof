import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApplicationsController } from './applications.controller';
import { EmployerApplicationsController } from './employer-applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ApplicationsController, EmployerApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
