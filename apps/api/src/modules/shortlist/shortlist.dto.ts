import { ShortlistStage } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AddShortlistEntryDto {
  @IsUUID()
  candidateId: string;

  @IsOptional()
  @IsUUID()
  jobId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ListShortlistDto {
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @IsOptional()
  @IsEnum(ShortlistStage)
  stage?: ShortlistStage;
}

export class UpdateShortlistEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
