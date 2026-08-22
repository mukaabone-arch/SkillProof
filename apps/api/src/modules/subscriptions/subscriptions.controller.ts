import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';
import { CheckoutSubscriptionDto, SwitchSubscriptionPlanDto } from './subscriptions.dto';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly svc: SubscriptionsService) {}

  @Get('me')
  getMine(@Req() req: AuthenticatedRequest) {
    return this.svc.getMine(req.user.sub);
  }

  @Post('checkout')
  checkout(@Req() req: AuthenticatedRequest, @Body() dto: CheckoutSubscriptionDto) {
    return this.svc.initiateCheckout(req.user.sub, dto.plan);
  }

  @Post('cancel')
  cancel(@Req() req: AuthenticatedRequest) {
    return this.svc.cancel(req.user.sub);
  }

  @Post('switch-plan')
  switchPlan(@Req() req: AuthenticatedRequest, @Body() dto: SwitchSubscriptionPlanDto) {
    return this.svc.switchPlan(req.user.sub, dto.plan);
  }
}
