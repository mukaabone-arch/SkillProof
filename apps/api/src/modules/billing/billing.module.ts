import { Module } from '@nestjs/common';
import { BillingProfilesService } from './billing-profiles.service';
import { TransactionsService } from './transactions.service';

@Module({
  providers: [BillingProfilesService, TransactionsService],
  exports: [BillingProfilesService, TransactionsService],
})
export class BillingModule {}
