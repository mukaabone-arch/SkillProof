import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

/**
 * Public contact form. Imports NotificationsModule purely for EMAIL_PROVIDER
 * (Resend) — the same direct-send seam AuthModule uses for pre-signup OTPs.
 * No PrismaModule: submissions are emailed, never stored (see ContactService).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
