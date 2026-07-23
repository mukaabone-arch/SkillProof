import { InterviewQuestionCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * The STAR reference point — see InterviewQuestion.expectedElements' doc
 * comment in schema.prisma. Every field here is a short descriptive phrase,
 * an illustrative example of a strong answer's shape, never a value a
 * candidate's real answer is checked against.
 */
export class StarReferenceDto {
  @IsString()
  @MaxLength(300)
  situation: string;

  @IsString()
  @MaxLength(300)
  task: string;

  @IsString()
  @MaxLength(300)
  action: string;

  @IsString()
  @MaxLength(300)
  result: string;
}

export class ListInterviewQuestionsQueryDto {
  @IsOptional()
  @IsEnum(InterviewQuestionCategory)
  category?: InterviewQuestionCategory;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  active?: boolean;
}

/** All fields optional — a curator edits one question at a time and only
 * ever sends what actually changed. */
export class UpdateInterviewQuestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @IsOptional()
  @IsEnum(InterviewQuestionCategory)
  category?: InterviewQuestionCategory;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  whatToLookFor?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StarReferenceDto)
  expectedElements?: StarReferenceDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  followUpProbes?: string[];

  @IsOptional()
  @IsBoolean()
  isCompanyGrounded?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
