import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { ResendEmailProvider } from './resend-email.provider';
import { SMS_PROVIDER } from './sms-provider.interface';
import { Msg91SmsProvider } from './msg91-sms.provider';

@Module({
  providers: [
    NotificationsService,
    { provide: EMAIL_PROVIDER, useClass: ResendEmailProvider },
    { provide: SMS_PROVIDER, useClass: Msg91SmsProvider },
  ],
  // EMAIL_PROVIDER / SMS_PROVIDER are exported alongside NotificationsService
  // so AuthModule can send pre-signup OTPs directly (no userId/Notification-row
  // lookup fits a pre-signup code — see AuthService.sendOtpEmail / sendOtpSms)
  // without a second provider instance.
  exports: [NotificationsService, EMAIL_PROVIDER, SMS_PROVIDER],
})
export class NotificationsModule {}
