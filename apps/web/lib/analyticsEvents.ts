/**
 * GA4 funnel events (2026-09): visit -> sign up -> verification complete ->
 * assessment started -> badge earned. Every call in this app must go
 * through `track()` below — never call `window.gtag` directly from a
 * component.
 *
 * NO PII, EVER. GA4's terms prohibit it and DPDP makes it worse — never
 * pass email, phone, name, user id, candidate profile id, org name, or
 * anything derived from them. Event parameters are categories and counts
 * only (see each typed helper below for exactly what each event carries).
 * Skill name and level are deliberately excluded too: skill names would
 * multiply cardinality fast, and levels would reintroduce the internal L1-L4
 * codes that were just swept out of user-facing text (see lib/skillLevels.ts).
 */

/**
 * No-ops when gtag isn't loaded — which is every visitor who declined
 * consent or hasn't decided yet, since AnalyticsGate (components/
 * AnalyticsGate.tsx) withholds the tag entirely rather than loading it with
 * denied signals. Deliberately does not queue: an event that happened
 * before consent must not be replayed after it.
 *
 * Never pass PII. Parameters are categories and counts only.
 */
export function track(event: string, params?: Record<string, string | number>): void {
  try {
    (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.('event', event, params);
  } catch {
    // Analytics must never break a flow it is only observing.
  }
}

/** How the account authenticated — reused across sign_up/login/verification_complete so all three read the same vocabulary. */
export type AuthMethod = 'phone_otp' | 'email_otp' | 'google' | 'github';
export type FunnelRole = 'candidate' | 'employer';

/**
 * Fires once per signup, from the callback that handles the auth response
 * (never from a useEffect that could re-run on a re-render/refresh) — see
 * apps/api's AuthService.issueTokens for isNewUser's own doc comment on why
 * the client can't determine this itself. sign_up/login are GA4's own
 * recommended event names, not custom ones — they get better treatment in
 * GA's reports than an equivalent custom name would.
 */
export function trackSignUp(method: AuthMethod, role: FunnelRole): void {
  track('sign_up', { method, role });
}

/** Counterpart to trackSignUp for isNewUser: false — same call site, same guard against double-firing. */
export function trackLogin(method: AuthMethod, role: FunnelRole): void {
  track('login', { method, role });
}

/**
 * Fires when a candidate's missing phone/email is resolved — meaning the
 * mandatory verification gate (CandidateVerificationGuard) actually clears,
 * not merely that one of the two link/* OTP flows succeeded. A candidate
 * missing both channels fires this once, on whichever call completes the
 * pair, never twice.
 */
export function trackVerificationComplete(method: Extract<AuthMethod, 'phone_otp' | 'email_otp'>): void {
  track('verification_complete', { method });
}

/**
 * Fires at the moment an Attempt or AssessmentSession row is actually
 * created — for an employer-requested assessment that's
 * AssessmentRequestsService.launchLinkedAssessment (fired from
 * EmployerInvitations.tsx's start()), NOT the take-flow page's own
 * subsequent POST /assessments/:id/attempts, which is that same backend
 * method's documented idempotent "active attempt already exists" resume,
 * not a second creation. See app/assessments/[id]/page.tsx's own comment on
 * how it avoids double-firing this for that case.
 */
export function trackAssessmentStarted(source: 'self_serve' | 'employer_request'): void {
  track('assessment_started', { source });
}

/**
 * MCQ (TEST format) only — fires once grading resolves synchronously in the
 * same submit round-trip. Deliberately NOT wired for the discussion format:
 * a DISCUSSION-format session can land in AWAITING_SCORING/AWAITING_REVIEW
 * after the candidate's last turn (human review before a badge is issued —
 * see EmployerOtpLogin.tsx's own copy), so there is no single client-side
 * moment where "submitted" and "passed: true|false" are both known at once
 * the way this event's contract assumes. Forcing a fire at conversation-end
 * with a not-yet-real passed value would misreport the funnel rather than
 * leave a gap in it.
 */
export function trackAssessmentSubmitted(passed: boolean): void {
  track('assessment_submitted', { passed: String(passed) });
}

/**
 * Fires when a badge is confirmed issued. Wired only where that's known
 * synchronously client-side (the MCQ result response) — a discussion-format
 * badge issued later via human review has no equivalent synchronous moment
 * on this page today (see trackAssessmentSubmitted's own comment); left as
 * a known gap rather than an invented one.
 */
export function trackBadgeEarned(): void {
  track('badge_earned');
}
