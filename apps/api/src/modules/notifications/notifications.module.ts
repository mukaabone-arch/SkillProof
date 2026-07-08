import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { ResendEmailProvider } from './resend-email.provider';

@Module({
  providers: [
    NotificationsService,
    { provide: EMAIL_PROVIDER, useClass: ResendEmailProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
