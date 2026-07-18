import { CandidateOfferResponse } from '@prisma/client';
import { IsEnum, IsIn } from 'class-validator';

const INVITE_RESPONSES = ['ACCEPT', 'DECLINE'] as const;

export class RespondInviteDto {
  @IsIn(INVITE_RESPONSES)
  response: (typeof INVITE_RESPONSES)[number];
}

export class RespondOfferDto {
  @IsEnum(CandidateOfferResponse)
  response: CandidateOfferResponse;
}
