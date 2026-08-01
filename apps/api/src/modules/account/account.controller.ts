import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountService } from './account.service';
import { DeactivateAccountDto, DeleteAccountDto } from './account.dto';

@Controller('account')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class AccountController {
  constructor(private readonly svc: AccountService) {}

  @Get('status')
  status(@Req() req: AuthenticatedRequest) {
    return this.svc.getStatus(req.user.sub);
  }

  @Post('deactivate')
  deactivate(@Req() req: AuthenticatedRequest, @Body() dto: DeactivateAccountDto) {
    return this.svc.deactivate(req.user.sub, dto);
  }

  @Post('reactivate')
  reactivate(@Req() req: AuthenticatedRequest) {
    return this.svc.reactivate(req.user.sub);
  }

  @Post('delete')
  delete(@Req() req: AuthenticatedRequest, @Body() dto: DeleteAccountDto) {
    return this.svc.delete(req.user.sub, dto);
  }
}
