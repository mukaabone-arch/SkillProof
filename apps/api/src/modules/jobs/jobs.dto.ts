import { EmploymentType, JobStatus, SkillLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * ₹10 crore/year in paise — generous for any real posting, tight enough to
 * catch a fat-fingered extra zero (same class of bug as a trailing-
 * underscore-mangled phone number). Job.salaryMin/salaryMax's own schema
 * doc comment is the source of truth on units (paise, annual-only); this
 * is just the bound, kept next to the DTO fields it actually constrains.
 */
const SALARY_MAX_PAISE = 10_000_000_000;

export class CreateJobDto {
  @IsString()
  @MaxLength(160)
  title: string;

  /** Employer-assigned requisition reference — see Job.code's doc comment for the uniqueness/normalization rules. */
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'code may only contain letters, numbers, and hyphens' })
  code: string;

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

  /** Paise — see Job.salaryMin's own schema doc comment for the unit/scope contract. Cross-field checks (min <= max, mutual exclusivity with salaryNotDisclosed) run in JobsService.assertSalaryShape, not here — same "shape here, invariants in the service" split as BillingProfilesService's owner-exclusivity check. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SALARY_MAX_PAISE)
  salaryMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SALARY_MAX_PAISE)
  salaryMax?: number;

  /** Only ever "INR" today — see Job.salaryCurrency's own schema doc comment. */
  @IsOptional()
  @IsIn(['INR'])
  salaryCurrency?: string;

  @IsOptional()
  @IsBoolean()
  salaryNotDisclosed?: boolean;

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
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'code may only contain letters, numbers, and hyphens' })
  code?: string;

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

  /** Explicit `null` clears a previously-set value — the only way to satisfy assertSalaryShape when toggling salaryNotDisclosed to true on a job that already has amounts (see JobsService.update's own comment). Plain omission leaves the existing value untouched, same as every other PATCH field on this DTO. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SALARY_MAX_PAISE)
  salaryMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SALARY_MAX_PAISE)
  salaryMax?: number | null;

  @IsOptional()
  @IsIn(['INR'])
  salaryCurrency?: string;

  @IsOptional()
  @IsBoolean()
  salaryNotDisclosed?: boolean;

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
