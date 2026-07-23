import { CandidateRoleTitle } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
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

  /**
   * Structured role dropdown — display/filter only, see CandidateRoleTitle's
   * doc comment in schema.prisma. NEVER read this in scoring.ts.
   */
  @IsOptional()
  @IsEnum(CandidateRoleTitle)
  roleTitle?: CandidateRoleTitle;

  /** Free text, only meaningful when roleTitle is OTHER. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  roleTitleOther?: string;

  /**
   * Structured city selection from GET /locations/search — sent together
   * as one unit whenever the candidate picks a suggestion from the
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
   * service failed, see LocationSearchService) or from an AI resume-parse
   * suggestion, both of which can only ever produce unstructured text.
   * Never populated by a real dropdown selection; that always sends the
   * structured fields above instead. See CandidateProfile.locationLegacy's
   * own doc comment for why this is never silently dropped either way.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationLegacy?: string;

  /**
   * Independent of location — see CandidateProfile.openToRemote's own doc
   * comment on why a remote-open candidate must never be excluded by a
   * future location filter.
   */
  @IsOptional()
  @IsBoolean()
  openToRemote?: boolean;

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
