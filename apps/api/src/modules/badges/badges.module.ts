import { Module } from '@nestjs/common';
import { BadgeResolverService } from './badge-resolver.service';

@Module({
  providers: [BadgeResolverService],
  exports: [BadgeResolverService],
})
export class BadgesModule {}
