import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssessmentRequestsModule } from '../assessment-requests/assessment-requests.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  // AssessmentRequestsModule — for AssessmentRequestsRefundJob, reused
  // by AccountService.makeCandidateUnavailableToEmployers to refund any
  // PAID_PENDING_START request the instant a candidate becomes unavailable.
  imports: [AuthModule, NotificationsModule, AssessmentRequestsModule],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
