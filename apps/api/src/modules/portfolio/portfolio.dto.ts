import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';

export class PortfolioExperienceEntryDto {
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

export class PortfolioEducationEntryDto {
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

export class PortfolioProjectEntryDto {
  @IsString()
  @MaxLength(160)
  name: string;

  @IsString()
  @MaxLength(1000)
  description: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  technologies: string[];

  @IsOptional()
  @IsUrl()
  @MaxLength(2000)
  url?: string | null;
}

export class PortfolioSkillGroupDto {
  @IsString()
  @MaxLength(80)
  category: string;

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills: string[];
}

/**
 * The candidate-editable shape of CandidatePortfolio.content — every field
 * the parse-review UI lets the candidate change before approving. Mirrors
 * LlmService's PortfolioExtraction field-for-field so a fresh parse and a
 * candidate's saved edits are always interchangeable.
 */
export class UpdatePortfolioContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  summary?: string | null;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PortfolioExperienceEntryDto)
  experience: PortfolioExperienceEntryDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PortfolioProjectEntryDto)
  projects: PortfolioProjectEntryDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PortfolioEducationEntryDto)
  education: PortfolioEducationEntryDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PortfolioSkillGroupDto)
  skillGroups: PortfolioSkillGroupDto[];
}

export class SetPortfolioVisibilityDto {
  @IsBoolean()
  visible: boolean;
}
