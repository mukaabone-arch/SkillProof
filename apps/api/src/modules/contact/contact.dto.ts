import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Reason-for-contact options. Kept in sync with the web <select> in
 * apps/web/app/contact/page.tsx — the value is what the browser posts, the
 * label is what the recipient reads (see CONTACT_REASON_LABELS). Adding an
 * option means adding it in both places.
 */
export const CONTACT_REASONS = [
  'general_enquiry',
  'candidate_support',
  'employer_enquiry',
  'partnership',
  'press',
  'other',
] as const;

export type ContactReason = (typeof CONTACT_REASONS)[number];

/** The description cap is enforced here (server-side) as well as by the browser's counter. */
export const CONTACT_DESCRIPTION_MAX = 2000;

/**
 * Public contact-form submission. Every field is validated server-side by the
 * global ValidationPipe (whitelist + forbidNonWhitelisted, see main.ts) — the
 * browser-side counter/required attributes are only a convenience, never the
 * gate. `company` is a honeypot: a real, hidden-from-humans field that only a
 * naive bot fills (see ContactService).
 */
export class ContactSubmissionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  @IsEmail()
  @MaxLength(254) // RFC 5321 max address length
  email: string;

  @IsIn(CONTACT_REASONS)
  reason: ContactReason;

  @IsString()
  @MinLength(1)
  @MaxLength(CONTACT_DESCRIPTION_MAX)
  description: string;

  /**
   * Honeypot. Named to look like a legitimate field a bot would want to fill;
   * hidden from real users in the UI. Optional + must be a string when present.
   * A non-empty value means "bot" — ContactService drops the submission
   * silently (still returns success) so the bot learns nothing.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;
}
