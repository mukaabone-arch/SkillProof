import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TaxonomyModule } from './modules/taxonomy/taxonomy.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { AdminModule } from './modules/admin/admin.module';
import { OrgsModule } from './modules/orgs/orgs.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { CandidatesModule } from './modules/candidates/candidates.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { ExternalCredentialsModule } from './modules/external-credentials/external-credentials.module';
import { CertificationsModule } from './modules/certifications/certifications.module';
import { AssessmentSessionsModule } from './modules/assessment-sessions/assessment-sessions.module';
import { BadgesModule } from './modules/badges/badges.module';
import { ShortlistModule } from './modules/shortlist/shortlist.module';
import { InterviewsModule } from './modules/interviews/interviews.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { ProfileViewsModule } from './modules/profile-views/profile-views.module';
import { PlansModule } from './modules/plans/plans.module';
import { LocationsModule } from './modules/locations/locations.module';
import { InterviewQuestionsModule } from './modules/interview-questions/interview-questions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    TaxonomyModule,
    BadgesModule,
    AssessmentsModule,
    ProfilesModule,
    AdminModule,
    OrgsModule,
    JobsModule,
    CandidatesModule,
    ApplicationsModule,
    ExternalCredentialsModule,
    CertificationsModule,
    AssessmentSessionsModule,
    ShortlistModule,
    InterviewsModule,
    DashboardModule,
    EntitlementsModule,
    ProfileViewsModule,
    PlansModule,
    LocationsModule,
    InterviewQuestionsModule,
  ],
})
export class AppModule {}
