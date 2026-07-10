import { IsOptional, IsPhoneNumber, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class RequestOtpDto {
  // 'IN' default region; accepts +91XXXXXXXXXX or local formats
  @IsPhoneNumber('IN')
  phone: string;
}

export class VerifyOtpDto {
  @IsPhoneNumber('IN')
  phone: string;

  @IsString()
  @Length(6, 6)
  otp: string;
}

export class EmployerRegisterDto {
  @IsPhoneNumber('IN')
  phone: string;

  @IsString()
  @Length(6, 6)
  otp: string;

  // Required by this endpoint even for returning users — the service ignores
  // it once the account already exists, but the field always being present
  // keeps the client simple (no separate signup-vs-login mode to track).
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  orgName: string;
}

/**
 * Authorization-code exchange sent by web (confidential client, no
 * codeVerifier needed) or the mobile app (native SDK / PKCE, so
 * codeVerifier is required there).
 */
export class OAuthCodeDto {
  @IsString()
  code: string;

  @IsString()
  redirectUri: string;

  @IsOptional()
  @IsString()
  codeVerifier?: string;
}

