import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BadgesModule } from '../badges/badges.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AssessmentSessionsModule } from '../assessment-sessions/assessment-sessions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingModule } from '../billing/billing.module';
import { EmployerAssessmentRequestsController } from './employer-assessment-requests.controller';
import { CandidateAssessmentRequestsController } from './candidate-assessment-requests.controller';
import { AssessmentRequestsService } from './assessment-requests.service';
import { AssessmentRequestsRefundJob } from './assessment-requests-refund.job';
import { AssessmentRequestBillingProfileService } from './assessment-request-billing-profile.service';
import { RAZORPAY_GATEWAY, RazorpaySdkGateway } from './razorpay-gateway';

@Module({
  imports: [AuthModule, BadgesModule, AssessmentsModule, AssessmentSessionsModule, NotificationsModule, BillingModule],
  // CandidateAssessmentRequestsController MUST be registered before
  // EmployerAssessmentRequestsController — Nest/Express matches routes in
  // registration order, and the employer controller's `GET
  // assessment-requests/:id` would otherwise greedily match `GET
  // assessment-requests/mine` (id='mine') first, 403ing every candidate who
  // tries to list their invitations (RolesGuard rejects a CANDIDATE token on
  // that employer-only route) before the candidate controller's own literal
  // `assessment-requests/mine` route ever gets a chance to run. Found while
  // verifying the candidate-facing disclosure copy in EmployerInvitations.tsx
  // — that component's own `.catch(() => setInvitations([]))` was silently
  // swallowing this, so no candidate had ever actually seen an invitation.
  controllers: [CandidateAssessmentRequestsController, EmployerAssessmentRequestsController],
  providers: [
    AssessmentRequestsService,
    AssessmentRequestsRefundJob,
    AssessmentRequestBillingProfileService,
    { provide: RAZORPAY_GATEWAY, useClass: RazorpaySdkGateway },
  ],
  // AssessmentRequestsRefundJob — so AccountService can reuse its refundOne
  // (atomic claim, double-refund guard, retry-via-REFUND_FAILED) when a
  // candidate deactivates or deletes, instead of duplicating that logic.
  exports: [AssessmentRequestsRefundJob],
})
export class AssessmentRequestsModule {}
