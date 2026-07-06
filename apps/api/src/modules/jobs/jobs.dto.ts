import { EmploymentType, JobStatus, SkillLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateJobDto {
  @IsString()
  @MaxLength(160)
  title: string;

  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  description: string;

  @IsEnum(EmploymentType)
  employmentType: EmploymentType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string;

  @IsOptional()
  @IsBoolean()
  remote?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  experienceMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  experienceMax?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMax?: number;

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;
}

export class UpdateJobDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string;

  @IsOptional()
  @IsBoolean()
  remote?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  experienceMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  experienceMax?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMax?: number;

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;
}

export class JobSkillItemDto {
  @IsUUID()
  skillId: string;

  @IsEnum(SkillLevel)
  requiredLevel: SkillLevel;

  @IsBoolean()
  isRequired: boolean;
}

export class SetJobSkillsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => JobSkillItemDto)
  skills: JobSkillItemDto[];
}

export class ParseJobDescriptionDto {
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  description: string;
}
