import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ShortlistModule } from '../shortlist/shortlist.module';
import { StaffingModule } from '../staffing/staffing.module';
import { ApiV1Controller, IntegrationsController } from './integrations.controllers';
import { IntegrationsService } from './integrations.service';
import { ApiV1Service } from './api-v1.service';
import { ApiKeyGuard } from './api-key.guard';

/** Integrations layer 1: Settings → Integrations (webhooks, API keys, candidate package) and the public API v1. */
@Module({
  imports: [AuthModule, ProfilesModule, ShortlistModule, StaffingModule],
  controllers: [IntegrationsController, ApiV1Controller],
  providers: [IntegrationsService, ApiV1Service, ApiKeyGuard],
})
export class IntegrationsModule {}
