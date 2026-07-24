import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { ResendEmailProvider } from './resend-email.provider';

@Module({
  providers: [
    NotificationsService,
    { provide: EMAIL_PROVIDER, useClass: ResendEmailProvider },
  ],
  // EMAIL_PROVIDER is exported alongside NotificationsService so AuthModule
  // can send employer-signup OTP emails directly (no userId/Notification-row
  // lookup fits a pre-signup code — see AuthService.sendOtpEmail) without a
  // second ResendEmailProvider instance.
  exports: [NotificationsService, EMAIL_PROVIDER],
})
export class NotificationsModule {}
