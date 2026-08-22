import { IsIn } from 'class-validator';

export type BillingInterval = 'MONTHLY' | 'ANNUAL';

export class CheckoutSubscriptionDto {
  @IsIn(['MONTHLY', 'ANNUAL'])
  plan: BillingInterval;
}

export class SwitchSubscriptionPlanDto {
  @IsIn(['MONTHLY', 'ANNUAL'])
  plan: BillingInterval;
}
