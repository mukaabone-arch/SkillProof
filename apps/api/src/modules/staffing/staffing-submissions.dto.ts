import { StaffingSubmissionStatus } from '@prisma/client';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateStaffingClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;
}

export class UpdateStaffingClientDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class CreateStaffingSubmissionDto {
  @IsUUID()
  candidateId!: string;

  @IsUUID()
  clientId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  roleTitle!: string;
}

export class UpdateSubmissionStatusDto {
  @IsIn(['INTERVIEWING', 'OFFER', 'PLACED', 'NOT_SELECTED', 'WITHDRAWN'])
  status!: StaffingSubmissionStatus;
}

export class DecideSubmissionDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
