import { Body, Controller, Post, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EmployerRegisterDto, RequestOtpDto, VerifyOtpDto } from './auth.dto';

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
