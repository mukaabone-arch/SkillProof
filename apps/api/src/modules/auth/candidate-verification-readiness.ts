import { BadRequestException } from '@nestjs/common';

/**
 * Single source of truth for "has this candidate verified both a phone
 * number and an email address" — same role for the candidate app as
 * org-readiness.ts plays for the employer portal, deliberately built the
 * same shape (missing* / is* / assert*) so the two gates can't drift apart in
 * structure. Enforced by CandidateVerificationGuard, which runs as part of
 * JwtAuthGuard itself rather than being attached per-controller — see that
 * guard's own doc comment for why this gate's blast radius (nearly every
 * candidate route) doesn't fit OrgSetupCompleteGuard's whole-controller
 * opt-in mechanism.
 *
 * presence-implies-verified: User.phone/email have no separate "verified"
 * column. Every write path (verifyOtp, verifyEmailOtp/verifyCandidateEmailOtp,
 * verifyLinkPhoneOtp/verifyLinkEmailOtp, invite acceptance, and the OAuth
 * paths — which only ever copy a provider-*verified* email onto User.email,
 * never an unverified one) only ever sets either column after real
 * verification succeeded. So presence alone is a safe proxy for verified
 * here — there is nothing else to check.
 */
export interface CandidateVerificationFields {
  phone: string | null;
  email: string | null;
}

export type MissingVerificationField = 'phone' | 'email';

export function missingVerificationFields(user: CandidateVerificationFields): MissingVerificationField[] {
  const missing: MissingVerificationField[] = [];
  if (user.phone == null) missing.push('phone');
  if (user.email == null) missing.push('email');
  return missing;
}

export function isCandidateVerified(user: CandidateVerificationFields): boolean {
  return missingVerificationFields(user).length === 0;
}

/**
 * Thrown by CandidateVerificationGuard — `code` follows the same
 * machine-readable convention as ORG_SETUP_INCOMPLETE/PROFILE_INCOMPLETE/
 * LIMIT_REACHED, so the client can render the right screen (the /verify
 * gate) off `code` alone. `missing` rides along for the same reason those
 * other assert functions include it — the client shouldn't have to
 * re-derive which channel is absent from a plain message string.
 */
export function assertCandidateVerified(user: CandidateVerificationFields): void {
  const missing = missingVerificationFields(user);
  if (missing.length === 0) return;

  throw new BadRequestException({
    code: 'CANDIDATE_VERIFICATION_INCOMPLETE',
    message: 'Add and verify both a phone number and an email address to continue.',
    missing,
  });
}
