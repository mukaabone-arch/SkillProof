export interface SendOtpSmsParams {
  /** Phone as stored on the account (e.g. "+919999999999"). The provider
   *  normalizes to whatever format its API expects. */
  to: string;
  /** The one-time code to deliver. Injected into the DLT-registered template. */
  otp: string;
}

/**
 * Swappable so MSG91 can be replaced (or mocked in tests) without touching
 * AuthService — the SMS counterpart to EmailProvider.
 *
 * Deliberately narrower than EmailProvider.send: on India's DLT regime a
 * transactional SMS can only carry a pre-registered template, so the only
 * thing a caller ever varies is the OTP variable. Exposing `sendOtp(to, otp)`
 * rather than `send(arbitrary text)` keeps that constraint honest at the seam.
 */
export interface SmsProvider {
  sendOtp(params: SendOtpSmsParams): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
