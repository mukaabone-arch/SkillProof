import { HiringProjectStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export const MAX_HEADCOUNT = 50;

export class CreateProjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /** null clears it. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsEnum(HiringProjectStatus)
  status?: HiringProjectStatus;
}

/** Links an existing job (any status) to the project as a role. */
export class AddRoleDto {
  @IsUUID()
  jobId: string;

  @IsInt()
  @Min(1)
  @Max(MAX_HEADCOUNT)
  headcount: number;

  @IsOptional()
  @IsDateString()
  targetStartDate?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_HEADCOUNT)
  headcount?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  targetStartDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}
