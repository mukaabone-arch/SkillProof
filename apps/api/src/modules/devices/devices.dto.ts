import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** POST /devices — FCM registration token for this app install. */
export class RegisterDeviceDto {
  // FCM tokens are ~150–250 chars today; the cap only stops abuse.
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;

  @IsIn(DEVICE_PLATFORMS)
  platform!: DevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;
}
