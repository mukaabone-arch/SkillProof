import { AvailabilityStatus, RateUnit, SkillLevel, WorkType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MAX_RATE_INR = 1_000_000_000;

/** PUT /staffing/me/availability — rules beyond field shapes live in normaliseAvailability. */
export class UpdateAvailabilityDto {
  @IsBoolean()
  openToStaffing!: boolean;

  @IsOptional()
  @IsEnum(AvailabilityStatus)
  availabilityStatus?: AvailabilityStatus;

  @IsOptional()
  @IsDateString()
  availableFrom?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  noticePeriodDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(WorkType, { each: true })
  workTypes?: WorkType[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RATE_INR)
  expectedRateMinInr?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RATE_INR)
  expectedRateMaxInr?: number;

  @IsOptional()
  @IsEnum(RateUnit)
  expectedRateUnit?: RateUnit;
}

/** POST /staffing/me/requests/:id/respond */
export class RespondStaffingRequestDto {
  @IsIn(['AVAILABLE', 'CONDITIONAL', 'NOT_NOW'])
  response!: 'AVAILABLE' | 'CONDITIONAL' | 'NOT_NOW';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  /** Also stop this company from finding or contacting the candidate again. */
  @IsOptional()
  @IsBoolean()
  block?: boolean;
}

/** GET /staffing/candidates */
export class SearchStaffingCandidatesDto {
  @IsOptional()
  @IsUUID()
  skillId?: string;

  @IsOptional()
  @IsEnum(SkillLevel)
  minLevel?: SkillLevel;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  availableWithinDays?: number;

  @IsOptional()
  @IsEnum(WorkType)
  workType?: WorkType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  /** 'true' also includes candidates in other cities who are open to remote work. */
  @IsOptional()
  @IsIn(['true', 'false'])
  remoteOk?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** POST /staffing/requests */
export class CreateStaffingRequestDto {
  @IsUUID()
  candidateId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  roleTitle!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  summary!: string;

  @IsEnum(WorkType)
  workType!: WorkType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RATE_INR)
  rateMinInr?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RATE_INR)
  rateMaxInr?: number;

  @IsOptional()
  @IsEnum(RateUnit)
  rateUnit?: RateUnit;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsBoolean()
  remote?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientIndustry?: string;
}
