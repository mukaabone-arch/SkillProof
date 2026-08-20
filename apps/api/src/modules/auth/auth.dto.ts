import { IsEmail, IsOptional, IsPhoneNumber, IsString, Length, MaxLength, MinLength, ValidateIf } from 'class-validator';

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
 * Employer signup/login by email instead of phone — see AuthService's
 * requestEmailOtp/verifyEmailOtp. Employer-only: there is no candidate
 * email+OTP flow, so unlike RequestOtpDto/VerifyOtpDto this pair is not
 * shared with a plain-candidate counterpart.
 */
export class EmployerEmailOtpRequestDto {
  @IsEmail()
  email: string;
}

export class EmployerEmailRegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  otp: string;

  // Genuinely optional here, unlike EmployerRegisterDto.orgName (phone path)
  // above: EmployerOtpLogin.tsx serves both login and signup from one
  // screen that can't know which until the OTP verifies, so a returning
  // employer must be able to submit a blank value. `@IsOptional()` alone
  // isn't enough — it only skips validation for null/undefined, and the
  // client sends '' (a trimmed empty string), not an omitted field — so
  // this uses `@ValidateIf` to skip the string/length checks specifically
  // for that empty-string case, matching the frontend's own validation
  // exactly (orgName.trim().length === 0 is allowed, a 1-character value
  // is not). Enforcing "a value is actually required to create a NEW
  // organization" is deliberately NOT done here — that depends on whether
  // this email already has an account, which only verifyEmailOtp's own DB
  // lookup knows; see the guard there, right before createEmployer.
  @ValidateIf((dto: EmployerEmailRegisterDto) => typeof dto.orgName === 'string' && dto.orgName.trim().length > 0)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  orgName: string;
}

/**
 * Candidate signup/login by email instead of phone — see AuthService's
 * requestCandidateEmailOtp/verifyCandidateEmailOtp. Mirrors
 * EmployerEmailOtpRequestDto/EmployerEmailRegisterDto's shape, minus
 * orgName — candidates have no organization to provision.
 */
export class CandidateEmailOtpRequestDto {
  @IsEmail()
  email: string;
}

export class CandidateEmailOtpVerifyDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  otp: string;
}

/**
 * Team-invite acceptance — see AuthService.requestInviteOtp/acceptInvite.
 * Same shape as EmployerEmailOtpRequestDto/EmployerEmailRegisterDto minus
 * orgName (the org comes from the pending OrgInvitation row, not the
 * invitee), kept as its own pair rather than reused since it's a distinct
 * flow (accepting a seat, not provisioning a new org).
 */
export class EmployerInviteOtpRequestDto {
  @IsEmail()
  email: string;
}

export class EmployerInviteOtpVerifyDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  otp: string;
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

