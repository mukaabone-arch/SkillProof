import { CandidateRoleTitle, SkillLevel } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class SearchCandidatesDto {
  @IsOptional()
  @IsUUID()
  skillId?: string;

  @IsOptional()
  @IsEnum(SkillLevel)
  minLevel?: SkillLevel;

  /** Display/filter only — see CandidateRoleTitle's doc comment. Narrows results, never affects scoring. */
  @IsOptional()
  @IsEnum(CandidateRoleTitle)
  roleTitle?: CandidateRoleTitle;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? true : value === true || value === 'true'))
  @IsBoolean()
  verifiedOnly: boolean = true;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 20 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 0 : Number(value)))
  @IsInt()
  @Min(0)
  offset: number = 0;
}
