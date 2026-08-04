import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BadgesModule } from '../badges/badges.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AssessmentSessionsModule } from '../assessment-sessions/assessment-sessions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmployerAssessmentRequestsController } from './employer-assessment-requests.controller';
import { CandidateAssessmentRequestsController } from './candidate-assessment-requests.controller';
import { AssessmentRequestsService } from './assessment-requests.service';
import { AssessmentRequestsRefundJob } from './assessment-requests-refund.job';
import { RAZORPAY_GATEWAY, RazorpaySdkGateway } from './razorpay-gateway';

@Module({
  imports: [AuthModule, BadgesModule, AssessmentsModule, AssessmentSessionsModule, NotificationsModule],
  controllers: [EmployerAssessmentRequestsController, CandidateAssessmentRequestsController],
  providers: [
    AssessmentRequestsService,
    AssessmentRequestsRefundJob,
    { provide: RAZORPAY_GATEWAY, useClass: RazorpaySdkGateway },
  ],
})
export class AssessmentRequestsModule {}
