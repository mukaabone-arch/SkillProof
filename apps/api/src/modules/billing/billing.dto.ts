import { TransactionStatus, TransactionType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/** Real GSTIN shape (15 chars: 2-digit state code, 10-char PAN, entity code, 'Z', checksum) — format only, no checksum verification. */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export class CreateBillingProfileDto {
  @IsString()
  @MaxLength(200)
  legalEntityName: string;

  @IsEmail()
  @MaxLength(255)
  billingEmail: string;

  @IsOptional()
  @IsPhoneNumber('IN')
  billingPhone?: string;

  @IsOptional()
  @Matches(GSTIN_PATTERN, { message: 'gstin must be a valid 15-character GSTIN' })
  gstin?: string;

  @IsString()
  @MaxLength(255)
  addressLine1: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsString()
  @MaxLength(120)
  city: string;

  @IsString()
  @MaxLength(120)
  state: string;

  @IsOptional()
  @Length(2, 2)
  gstStateCode?: string;

  @IsString()
  @MaxLength(20)
  postalCode: string;

  @IsOptional()
  @Length(2, 2)
  country?: string;
}

/** Every field optional — a partial patch, same shape as UpdateProfileDto/UpdateOrgDto elsewhere in this codebase. */
export class UpdateBillingProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalEntityName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  billingEmail?: string;

  @IsOptional()
  @IsPhoneNumber('IN')
  billingPhone?: string;

  @IsOptional()
  @Matches(GSTIN_PATTERN, { message: 'gstin must be a valid 15-character GSTIN' })
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @Length(2, 2)
  gstStateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @Length(2, 2)
  country?: string;
}

/**
 * The financial core, set once — see Transaction's own doc comment in
 * schema.prisma. No `id`/`amendsTransactionId` here on purpose: creation
 * always makes a fresh top-level row; amending an existing one is a
 * separate DTO/endpoint (AmendTransactionDto) so the two intents can never
 * be confused at the type level.
 */
export class CreateTransactionDto {
  @IsInt()
  @Min(1)
  amountPaise: number;

  @IsOptional()
  @Length(3, 3)
  currency?: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsEnum(TransactionStatus)
  status: TransactionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** Same shape as CreateTransactionDto — an amendment is an ordinary transaction row with its own financial core, just linked to what it corrects. */
export class AmendTransactionDto extends CreateTransactionDto {}

/** Fills in provider/providerOrderId/providerPaymentId — the one narrow, null->value-only exception to Transaction's immutability. See TransactionsService.attachProviderReference. */
export class AttachProviderReferenceDto {
  @IsString()
  @MaxLength(60)
  provider: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerPaymentId?: string;
}

/** The only way status may change post-creation — validated against the state machine in TransactionsService.transitionStatus, never a bare field write. */
export class UpdateTransactionStatusDto {
  @IsEnum(TransactionStatus)
  status: TransactionStatus;
}
