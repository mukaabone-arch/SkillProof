import { BadRequestException, Body, Controller, Param, Post, HttpCode, Req, UseGuards } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { AuthService } from './auth.service';
import { EmployerRegisterDto, OAuthCodeDto, RequestOtpDto, VerifyOtpDto } from './auth.dto';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.otp);
  }

  /** Employer signup/login — reuses the same OTP request flow at /auth/otp/request. */
  @Post('employer/register')
  @HttpCode(200)
  employerRegister(@Body() dto: EmployerRegisterDto) {
    return this.auth.verifyOtp(dto.phone, dto.otp, dto.orgName);
  }

  /**
   * Authorization-code exchange. Web sends the code from its own redirect;
   * the mobile app runs the native SDK / PKCE flow and forwards the
   * resulting code + codeVerifier here. Either way we issue the same JWT
   * access + refresh token pair as /auth/otp/verify.
   */
  @Post('google')
  @HttpCode(200)
  loginWithGoogle(@Body() dto: OAuthCodeDto) {
    return this.auth.loginWithGoogle(dto);
  }

  @Post('github')
  @HttpCode(200)
  loginWithGithub(@Body() dto: OAuthCodeDto) {
    return this.auth.loginWithGithub(dto);
  }

  /**
   * Employer-portal counterpart of /auth/google and /auth/github — same
   * code exchange, but only issues a token if the resolved account already
   * has an employer role and an OrgMember; see AuthService.loginEmployerWithIdentity.
   */
  @Post('employer/google')
  @HttpCode(200)
  loginEmployerWithGoogle(@Body() dto: OAuthCodeDto) {
    return this.auth.loginEmployerWithGoogle(dto);
  }

  @Post('employer/github')
  @HttpCode(200)
  loginEmployerWithGithub(@Body() dto: OAuthCodeDto) {
    return this.auth.loginEmployerWithGithub(dto);
  }

  /** Explicit "connect provider" from settings while already logged in — links regardless of email match. */
  @Post('connect/:provider')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  connectProvider(
    @Req() req: AuthenticatedRequest,
    @Param('provider') provider: string,
    @Body() dto: OAuthCodeDto,
  ) {
    const normalized = provider.toUpperCase();
    if (normalized !== IdentityProvider.GOOGLE && normalized !== IdentityProvider.GITHUB) {
      throw new BadRequestException('Unsupported provider');
    }
    return this.auth.connectProvider(req.user.sub, normalized, dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body?.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: { refreshToken: string }) {
    return this.auth.logout(body?.refreshToken);
  }
}
