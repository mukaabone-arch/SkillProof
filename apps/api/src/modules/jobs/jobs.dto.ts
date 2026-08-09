import { EmploymentType, JobStatus, SkillLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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

  /**
   * Structured city selection from GET /locations/search — sent together
   * as one unit whenever the employer picks a suggestion from the
   * dropdown. locationCountry is ISO 3166-1 alpha-2 (e.g. "US"), never a
   * display name — see LocationSuggestion's own doc comment.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationRegion?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  locationCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationPlaceId?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  locationLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  locationLng?: number;

  /**
   * Free text — written when the city dropdown is unusable (the search
   * service failed) or from an AI job-description-parse suggestion, both
   * of which can only ever produce unstructured text. Never populated by
   * a real dropdown selection; that always sends the structured fields
   * above instead. See Job.locationLegacy's own doc comment for why this
   * is never silently dropped either way.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationLegacy?: string;

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
  @MaxLength(120)
  locationCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationRegion?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  locationCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationPlaceId?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  locationLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  locationLng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationLegacy?: string;

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
