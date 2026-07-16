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
import { AssessmentSessionsModule } from './modules/assessment-sessions/assessment-sessions.module';
import { BadgesModule } from './modules/badges/badges.module';

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
    AssessmentSessionsModule,
  ],
})
export class AppModule {}
