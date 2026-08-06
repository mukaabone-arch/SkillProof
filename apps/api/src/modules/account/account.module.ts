import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssessmentRequestsModule } from '../assessment-requests/assessment-requests.module';
import { DataExportModule } from '../data-export/data-export.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  // AssessmentRequestsModule — for AssessmentRequestsRefundJob, reused
  // by AccountService.makeCandidateUnavailableToEmployers to refund any
  // PAID_PENDING_START request the instant a candidate becomes unavailable.
  // DataExportModule — "Download my data" lives on AccountController,
  // same family of rights as deactivate/delete (see that page's own
  // comment), backed by its own service rather than folded into
  // AccountService.
  imports: [AuthModule, NotificationsModule, AssessmentRequestsModule, DataExportModule],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
