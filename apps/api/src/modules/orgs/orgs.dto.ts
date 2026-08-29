import { OrgIndustry } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

export class UpdateOrgDto {
  @IsOptional()
  @IsEnum(OrgIndustry)
  industry?: OrgIndustry;

  /**
   * Required (and only meaningful) when industry is OTHER — same
   * CertIssuer/issuerOther convention, not CandidateRoleTitle/
   * roleTitleOther's looser UI-only pairing, since industry feeds the
   * mandatory org-setup gate (see org-readiness.ts).
   */
  @ValidateIf((o: UpdateOrgDto) => o.industry === OrgIndustry.OTHER)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  industryOther?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  website?: string;
}

/**
 * Server-side confirmation, not just a frontend UX nicety — same pattern
 * as AccountService.delete's `dto.confirmation !== 'DELETE'` check.
 * Validated against the organization's real name in OrgsService.deactivate.
 */
export class DeactivateOrgDto {
  @IsString()
  @IsNotEmpty()
  confirmOrgName: string;
}
