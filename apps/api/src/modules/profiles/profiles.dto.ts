import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  /** Used for job/application notifications — kept on User, not CandidateProfile. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(80)
  yearsOfExp?: number;

  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  githubUrl?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  linkedinUrl?: string;
}

export class ExperienceEntryDto {
  @IsString()
  @MaxLength(160)
  title: string;

  @IsString()
  @MaxLength(160)
  company: string;

  @IsString()
  @MaxLength(80)
  dates: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  bullets: string[];
}

export class EducationEntryDto {
  @IsString()
  @MaxLength(160)
  degree: string;

  @IsString()
  @MaxLength(160)
  institution: string;

  @IsString()
  @MaxLength(80)
  dates: string;
}

/**
 * Body for POST /profiles/me/resume/generate. Every field is optional so the
 * same endpoint serves both frontend paths: "Build from my profile" sends an
 * empty body (profile + verified badges only), "Improve my resume" sends the
 * candidate-edited improved content. Never written to the profile — this is
 * purely the content of a one-off PDF.
 */
export class GenerateResumeDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExperienceEntryDto)
  experience?: ExperienceEntryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EducationEntryDto)
  education?: EducationEntryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];
}
