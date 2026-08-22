import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { SubscriptionBillingProfileService } from './subscription-billing-profile.service';
import { RAZORPAY_SUBSCRIPTION_GATEWAY, RazorpaySdkSubscriptionGateway } from './razorpay-subscription-gateway';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [SubscriptionsController, RazorpayWebhookController],
  providers: [
    SubscriptionsService,
    RazorpayWebhookService,
    SubscriptionBillingProfileService,
    { provide: RAZORPAY_SUBSCRIPTION_GATEWAY, useClass: RazorpaySdkSubscriptionGateway },
  ],
  // SubscriptionsService — so AccountModule can call cancelImmediatelyForDeletion from AccountService.delete.
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
