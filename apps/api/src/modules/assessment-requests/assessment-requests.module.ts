import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BadgesModule } from '../badges/badges.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AssessmentSessionsModule } from '../assessment-sessions/assessment-sessions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { EmployerAssessmentRequestsController } from './employer-assessment-requests.controller';
import { CandidateAssessmentRequestsController } from './candidate-assessment-requests.controller';
import { AssessmentRequestsService } from './assessment-requests.service';
import { AssessmentRequestsExpiryJob } from './assessment-requests-expiry.job';
import { AssessmentRequestInvoicingJob } from './assessment-request-invoicing.job';
import { AssessmentRequestBillingProfileService } from './assessment-request-billing-profile.service';

@Module({
  imports: [AuthModule, BadgesModule, AssessmentsModule, AssessmentSessionsModule, NotificationsModule, BillingModule, DocumentsModule],
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
  providers: [AssessmentRequestsService, AssessmentRequestsExpiryJob, AssessmentRequestInvoicingJob, AssessmentRequestBillingProfileService],
  // AssessmentRequestsExpiryJob — so AccountService can reuse its excludeOne
  // (atomic claim, start-vs-expiry race guard) when a candidate deactivates
  // or deletes, instead of duplicating that logic.
  exports: [AssessmentRequestsExpiryJob],
})
export class AssessmentRequestsModule {}
