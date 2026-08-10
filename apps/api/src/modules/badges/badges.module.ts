import { Module } from '@nestjs/common';
import { BadgeResolverService } from './badge-resolver.service';
import { BadgeExpirySweepService } from './badge-expiry-sweep.service';

@Module({
  providers: [BadgeResolverService, BadgeExpirySweepService],
  exports: [BadgeResolverService],
})
export class BadgesModule {}
