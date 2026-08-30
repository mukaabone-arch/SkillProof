import { BadRequestException, Body, Controller, Get, Param, Post, HttpCode, Req, UseGuards } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { AuthService } from './auth.service';
import {
  CandidateEmailOtpRequestDto,
  CandidateEmailOtpVerifyDto,
  EmployerEmailOtpRequestDto,
  EmployerEmailRegisterDto,
  EmployerInviteOtpRequestDto,
  EmployerInviteOtpVerifyDto,
  EmployerRegisterDto,
  OAuthCodeDto,
  RequestOtpDto,
  VerifyOtpDto,
} from './auth.dto';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';
import { SkipVerificationGate } from './skip-verification-gate.decorator';

/**
 * Exempt from CandidateVerificationGuard entirely — see that guard's own
 * doc comment. This is exactly how a gated candidate complies (the link/*
 * endpoints below), plus refresh/logout/terms-acceptance/connect, none of
 * which is "app usage" the gate is meant to block.
 */
@Controller('auth')
@SkipVerificationGate()
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

  /**
   * Email counterpart to /auth/otp/request for candidates — both channels
   * deliver for real in production (see AuthService's class doc). Mirrors
   * /auth/employer/otp/request.
   */
  @Post('email/otp/request')
  @HttpCode(200)
  requestCandidateEmailOtp(@Body() dto: CandidateEmailOtpRequestDto) {
    return this.auth.requestCandidateEmailOtp(dto.email);
  }

  /** Email counterpart to /auth/otp/verify for candidates — see AuthService.verifyCandidateEmailOtp. */
  @Post('email/otp/verify')
  @HttpCode(200)
  verifyCandidateEmailOtp(@Body() dto: CandidateEmailOtpVerifyDto) {
    return this.auth.verifyCandidateEmailOtp(dto.email, dto.otp);
  }

  /** Employer signup/login — reuses the same OTP request flow at /auth/otp/request. */
  @Post('employer/register')
  @HttpCode(200)
  employerRegister(@Body() dto: EmployerRegisterDto) {
    return this.auth.verifyOtp(dto.phone, dto.otp, dto.orgName);
  }

  /**
   * Email counterpart to /auth/otp/request, employer-signup only — see
   * AuthService's class doc; both channels deliver for real in production.
   */
  @Post('employer/otp/request')
  @HttpCode(200)
  requestEmployerEmailOtp(@Body() dto: EmployerEmailOtpRequestDto) {
    return this.auth.requestEmailOtp(dto.email);
  }

  /** Email counterpart to /auth/employer/register — see AuthService.verifyEmailOtp. */
  @Post('employer/otp/verify')
  @HttpCode(200)
  employerEmailRegister(@Body() dto: EmployerEmailRegisterDto) {
    return this.auth.verifyEmailOtp(dto.email, dto.otp, dto.orgName);
  }

  /**
   * Team-invite acceptance, step 1: request a code for a pending
   * invitation's email — see AuthService.requestInviteOtp. Distinct from
   * /auth/employer/otp/request, which is plain employer signup/login; this
   * 404s (via a 400) if there's no pending invitation for the email.
   */
  @Post('employer/invite/otp/request')
  @HttpCode(200)
  requestInviteOtp(@Body() dto: EmployerInviteOtpRequestDto) {
    return this.auth.requestInviteOtp(dto.email);
  }

  /** Team-invite acceptance, step 2 — see AuthService.acceptInvite. */
  @Post('employer/invite/otp/verify')
  @HttpCode(200)
  acceptInvite(@Body() dto: EmployerInviteOtpVerifyDto) {
    return this.auth.acceptInvite(dto.email, dto.otp);
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
   * Employer-portal counterpart of /auth/github — same code exchange, but
   * only issues a token if the resolved account already has an employer
   * role and an OrgMember; see AuthService.loginEmployerWithIdentity.
   * Google has no employer-portal counterpart: employer login is email-OTP
   * only (see EmployerOtpLogin.tsx), since employer signup enforces a
   * company email domain (COMPANY_EMAIL_REQUIRED) and a Google account
   * would let someone bypass that check.
   */
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

  /**
   * Add a second login identifier to the CURRENT account (phone or email),
   * OTP-verified — how a candidate who signed up one way attaches the other
   * to the same account instead of creating a second one. See
   * AuthService.requestLinkPhoneOtp / verifyLinkPhoneOtp (and the email pair).
   */
  @Post('link/phone/request')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  requestLinkPhoneOtp(@Req() req: AuthenticatedRequest, @Body() dto: RequestOtpDto) {
    return this.auth.requestLinkPhoneOtp(req.user.sub, dto.phone);
  }

  @Post('link/phone/verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  verifyLinkPhoneOtp(@Req() req: AuthenticatedRequest, @Body() dto: VerifyOtpDto) {
    return this.auth.verifyLinkPhoneOtp(req.user.sub, dto.phone, dto.otp);
  }

  @Post('link/email/request')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  requestLinkEmailOtp(@Req() req: AuthenticatedRequest, @Body() dto: CandidateEmailOtpRequestDto) {
    return this.auth.requestLinkEmailOtp(req.user.sub, dto.email);
  }

  @Post('link/email/verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  verifyLinkEmailOtp(@Req() req: AuthenticatedRequest, @Body() dto: CandidateEmailOtpVerifyDto) {
    return this.auth.verifyLinkEmailOtp(req.user.sub, dto.email, dto.otp);
  }

  /**
   * Replace an EXISTING login identifier on the CURRENT account, OTP-verified
   * against the new value — candidate-only (see AuthService's
   * assertPhoneChangeable/assertEmailChangeable), for a candidate whose
   * number or address changed rather than one adding a missing channel. See
   * AuthService.requestChangePhoneOtp / verifyChangePhoneOtp (and the email
   * pair) for the full contract, including the old-value notification.
   */
  @Post('change/phone/request')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  requestChangePhoneOtp(@Req() req: AuthenticatedRequest, @Body() dto: RequestOtpDto) {
    return this.auth.requestChangePhoneOtp(req.user.sub, dto.phone);
  }

  @Post('change/phone/verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  verifyChangePhoneOtp(@Req() req: AuthenticatedRequest, @Body() dto: VerifyOtpDto) {
    return this.auth.verifyChangePhoneOtp(req.user.sub, dto.phone, dto.otp);
  }

  @Post('change/email/request')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  requestChangeEmailOtp(@Req() req: AuthenticatedRequest, @Body() dto: CandidateEmailOtpRequestDto) {
    return this.auth.requestChangeEmailOtp(req.user.sub, dto.email);
  }

  @Post('change/email/verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  verifyChangeEmailOtp(@Req() req: AuthenticatedRequest, @Body() dto: CandidateEmailOtpVerifyDto) {
    return this.auth.verifyChangeEmailOtp(req.user.sub, dto.email, dto.otp);
  }

  /**
   * The current user's most recent Terms/Privacy acceptance record (or null
   * for accounts created before acceptance was recorded). Makes the record
   * retrievable per user — see AuthService.getTermsAcceptance.
   */
  @Get('terms-acceptance')
  @UseGuards(JwtAuthGuard)
  getTermsAcceptance(@Req() req: AuthenticatedRequest) {
    return this.auth.getTermsAcceptance(req.user.sub);
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
