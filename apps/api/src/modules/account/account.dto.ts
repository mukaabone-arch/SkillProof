import { AccountActionReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Shared by both deactivate and delete — see AccountActionReason's own doc
 * comment. Both fields are optional at every layer (DTO, service, schema)
 * on purpose: GDPR/DPDP erasure must never be conditional on answering a
 * question, so nothing here may ever become a required field later without
 * that being a deliberate, separate decision.
 */
class AccountActionReasonDto {
  @IsOptional()
  @IsEnum(AccountActionReason)
  reasonCategory?: AccountActionReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reasonText?: string;
}

export class DeactivateAccountDto extends AccountActionReasonDto {}

/**
 * confirmation must literally equal the word "DELETE" — checked in
 * AccountService.delete, not here, so the error message can be specific
 * ("type DELETE to confirm") rather than class-validator's generic
 * shape-mismatch message. Kept as a plain required string rather than a
 * regex/equals validator for that reason.
 */
export class DeleteAccountDto extends AccountActionReasonDto {
  @IsString()
  confirmation: string;
}
