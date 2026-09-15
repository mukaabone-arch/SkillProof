import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown by AssessmentsService.startAttempt (assertNotBlocked) when a
 * time-boxed AssessmentBlock bars starting a new MCQ attempt. Distinct
 * `code` — mirrors EntitlementLimitException's own reasoning — so the
 * client renders its own "assessments are paused" screen off `code` alone,
 * never a generic 400: a candidate needs the exact resume timestamp and a
 * way to contest it, not "request failed."
 *
 * `expiresAt` is the only detail this carries. It deliberately does NOT
 * include `reason`/`triggerAttemptIds` — those are for admin review only;
 * exposing which behaviours were detected to the candidate would hand out
 * a cheating manual (see the candidate-facing copy's own requirement).
 */
export class AssessmentBlockedException extends HttpException {
  constructor(expiresAt: Date) {
    super({ code: 'ASSESSMENT_BLOCKED', expiresAt }, HttpStatus.FORBIDDEN);
  }
}
