export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

/** Swappable so Resend can be replaced (or mocked in tests) without touching NotificationService. */
export interface EmailProvider {
  send(params: SendEmailParams): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
