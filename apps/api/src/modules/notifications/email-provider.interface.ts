export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /**
   * Optional Reply-To. Left unset by every transactional send (OTPs,
   * notifications) whose `from` already routes replies correctly; set by the
   * public contact form so a reply from info@ goes straight to the submitter
   * rather than the verified sending address (see ContactService).
   */
  replyTo?: string;
}

/** Swappable so Resend can be replaced (or mocked in tests) without touching NotificationService. */
export interface EmailProvider {
  send(params: SendEmailParams): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
