import { Transform } from 'class-transformer';
import { IsEmail, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';

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
