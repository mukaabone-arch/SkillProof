import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsService } from './entitlements.service';
import { EntitlementGuard } from './entitlement.guard';
import { EntitlementRefundInterceptor } from './entitlement-refund.interceptor';

@Module({
  imports: [AuthModule],
  controllers: [EntitlementsController],
  providers: [
    EntitlementsService,
    EntitlementGuard,
    // Global — see EntitlementRefundInterceptor's own doc comment for why
    // this pairs with EntitlementGuard automatically rather than needing
    // @UseInterceptors at every @RequiresEntitlement route.
    { provide: APP_INTERCEPTOR, useClass: EntitlementRefundInterceptor },
  ],
  exports: [EntitlementsService, EntitlementGuard],
})
export class EntitlementsModule {}
