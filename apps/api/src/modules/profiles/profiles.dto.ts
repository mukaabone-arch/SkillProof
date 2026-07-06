import { IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

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
