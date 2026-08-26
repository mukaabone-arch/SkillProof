import { SetMetadata } from '@nestjs/common';

export const SKIP_VERIFICATION_GATE_KEY = 'skipVerificationGate';

/**
 * Exempts a controller/route from CandidateVerificationGuard — the
 * candidate-verification counterpart to @Roles/ROLES_KEY's SetMetadata +
 * Reflector idiom. Applied class-wide on AuthController (the linking
 * endpoints a gated candidate needs in order to comply, plus refresh/
 * logout/terms — none of it "app usage") and AccountController (deactivate/
 * reactivate/delete/export — DPDP-mandated rights this gate must never
 * block), and method-wide on UsersController.me (so the gate screen itself
 * can read current phone/email status).
 */
export const SkipVerificationGate = () => SetMetadata(SKIP_VERIFICATION_GATE_KEY, true);
