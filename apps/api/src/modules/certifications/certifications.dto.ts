import { CertIssuer } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * skillTags arrives as a JSON-encoded string on multipart/form-data requests
 * (FormData can't carry a real array field) — parsed here so the rest of the
 * pipeline (and the DB column) only ever deals with string[]. Left as-is if
 * it's already an array (a plain JSON POST, e.g. from an future non-file
 * edit) or isn't valid JSON, so @IsArray below produces the real validation
 * error instead of this silently swallowing a malformed value.
 */
function parseSkillTags({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

/**
 * Shared by create and update — both are multipart/form-data (the optional
 * file lives alongside these fields, see CertificationsController), and both
 * enforce the same "at least one of credentialUrl / file" rule, which is why
 * that check lives in CertificationsService rather than here: it depends on
 * whether a file was actually attached to *this* request, which only the
 * controller/interceptor knows.
 */
export class CertificationFieldsDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsEnum(CertIssuer)
  issuer: CertIssuer;

  /** Required (and only meaningful) when issuer is OTHER — see the issuer dropdown spec. */
  @ValidateIf((o: CertificationFieldsDto) => o.issuer === CertIssuer.OTHER)
  @IsString()
  @MaxLength(120)
  issuerOther?: string;

  @IsDateString()
  issueDate: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  credentialId?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  credentialUrl?: string;

  /**
   * Skill.id values from the existing taxonomy (GET /taxonomy) — never
   * free text. Validated for existence against the Skill table in
   * CertificationsService, not just shape here.
   */
  @IsOptional()
  @Transform(parseSkillTags)
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  skillTags?: string[];
}

export class CreateCertificationDto extends CertificationFieldsDto {}

/**
 * Same fields as create, all effectively optional in practice since the
 * candidate is editing one field at a time — but kept as required on the
 * DTO (matching CreateCertificationDto) because the edit form always
 * resubmits the whole record, not a partial patch; see CertificationsPanel.
 */
export class UpdateCertificationDto extends CertificationFieldsDto {}
