import { IsPhoneNumber, IsString, Length } from 'class-validator';

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
