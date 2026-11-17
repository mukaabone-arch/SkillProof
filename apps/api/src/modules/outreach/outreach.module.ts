import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { OutreachCandidateController, OutreachOrgController, OutreachPublicController } from './outreach.controllers';
import { OutreachService } from './outreach.service';
import { OutreachCandidateService } from './outreach-candidate.service';
import { OutreachFollowUpJob } from './outreach-follow-up.job';

@Module({
  imports: [AuthModule, LlmModule, NotificationsModule, EntitlementsModule],
  controllers: [OutreachOrgController, OutreachCandidateController, OutreachPublicController],
  providers: [OutreachService, OutreachCandidateService, OutreachFollowUpJob],
})
export class OutreachModule {}
