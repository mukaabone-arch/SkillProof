import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  website?: string;
}
