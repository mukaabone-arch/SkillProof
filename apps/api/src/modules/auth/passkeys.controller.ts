import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { Request } from 'express';
import { PasskeyRegisterVerifyDto, PasskeyVerifyDto } from './auth.dto';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';
import { PasskeysService } from './passkeys.service';
import { SkipVerificationGate } from './skip-verification-gate.decorator';
import { clientIp, InMemoryRateLimiter } from '../../common/ip-rate-limiter';

/** Exempt from CandidateVerificationGuard for the same reason AuthController is — auth plumbing, not app usage. */
@Controller('auth/passkeys')
@SkipVerificationGate()
export class PasskeysController {
  /** Public sign-in routes only: 30 per IP per minute each. */
  private readonly limiter = new InMemoryRateLimiter(0, 30, 60_000);

  constructor(private readonly passkeys: PasskeysService) {}

  @Post('login/options')
  @HttpCode(200)
  loginOptions(@Req() req: Request) {
    this.limiter.hit(`options:${clientIp(req)}`);
    return this.passkeys.loginOptions();
  }

  @Post('login/verify')
  @HttpCode(200)
  loginVerify(@Req() req: Request, @Body() dto: PasskeyVerifyDto) {
    this.limiter.hit(`verify:${clientIp(req)}`);
    return this.passkeys.verifyLogin(dto.challengeId, dto.response as unknown as AuthenticationResponseJSON);
  }

  @Post('register/options')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  registerOptions(@Req() req: AuthenticatedRequest) {
    return this.passkeys.registrationOptions(req.user.sub);
  }

  @Post('register/verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  registerVerify(@Req() req: AuthenticatedRequest, @Body() dto: PasskeyRegisterVerifyDto) {
    return this.passkeys.verifyRegistration(
      req.user.sub,
      dto.challengeId,
      dto.response as unknown as RegistrationResponseJSON,
      dto.name,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: AuthenticatedRequest) {
    return this.passkeys.list(req.user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.passkeys.remove(req.user.sub, id);
  }
}
