import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_PROVIDER, EmailProvider } from '../notifications/email-provider.interface';
import { ContactReason, ContactSubmissionDto } from './contact.dto';

/** NestJS has no built-in 429 exception — same one AuthService defines for its OTP limiter. */
class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** Human-readable labels for the recipient — keyed by the DTO's machine values (see contact.dto.ts). */
const CONTACT_REASON_LABELS: Record<ContactReason, string> = {
  general_enquiry: 'General enquiry',
  candidate_support: 'Candidate support',
  employer_enquiry: 'Employer enquiry',
  partnership: 'Partnership',
  press: 'Press',
  other: 'Other',
};

/**
 * Where contact-form mail lands. Overridable via CONTACT_TO_EMAIL for
 * staging/testing without code changes; defaults to the real inbox.
 */
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || 'info@flairfuture.com';

interface RateEntry {
  count: number;
  windowStart: number;
  lastAt: number;
}

/**
 * Contact form backend for the public marketing form. Sends via EMAIL_PROVIDER
 * (Resend, already live) exactly the way AuthService sends pre-signup OTPs —
 * directly, not through NotificationsService.sendEmail, which needs a userId
 * and a Notification row that a not-signed-in visitor doesn't have.
 *
 * Deliberately stateless: submissions are emailed and NOT persisted. That
 * keeps submitter personal data out of our database entirely (no new retention
 * obligation, nothing to add to the privacy policy, nothing to include in a
 * data-export/erasure request) — the email in the info@ inbox is the single
 * record, which is where a human acts on it anyway.
 *
 * Abuse controls, because this is a public unauthenticated endpoint that sends
 * mail from our verified domain (uncontrolled, it's an open relay that would
 * burn our sending reputation and take OTP deliverability down with it):
 *  - Per-IP rate limit (in-memory, same shape as AuthService's OTP limiter):
 *    a short cooldown between sends plus a cap per rolling window.
 *  - Honeypot field (see ContactSubmissionDto.company): filled ⇒ dropped
 *    silently with a success response, so bots get no signal.
 * A full CAPTCHA is intentionally not added — overkill for current volume and
 * a UX/privacy cost; the honeypot + rate limit are the cheap, effective 90%.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private readonly rateStore = new Map<string, RateEntry>();

  // Same knobs as AuthService's limiter, tuned for a form a human submits once:
  private readonly COOLDOWN_MS = 30 * 1000; // min gap between two sends from one IP
  private readonly MAX_PER_WINDOW = 5; // cap per window per IP
  private readonly WINDOW_MS = 60 * 60 * 1000; // rolling 1-hour window

  constructor(@Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider) {}

  async submit(dto: ContactSubmissionDto, ip: string): Promise<{ ok: true }> {
    // Honeypot: a real user never sees this field, so a value means a bot.
    // Drop silently — same success shape as a real send, so the bot can't
    // distinguish a drop from a delivery. Not rate-limited/counted either.
    if (dto.company && dto.company.trim().length > 0) {
      this.logger.warn(`Contact form honeypot triggered (ip=${ip}) — dropped`);
      return { ok: true };
    }

    this.enforceRateLimit(ip);

    const fullName = dto.fullName.trim();
    const email = dto.email.trim();
    const description = dto.description.trim();
    if (description.length === 0) {
      // MinLength(1) accepts a single space; a whitespace-only body is still empty.
      throw new HttpException('Description cannot be empty.', HttpStatus.BAD_REQUEST);
    }

    const reasonLabel = CONTACT_REASON_LABELS[dto.reason];
    const subject = `Contact form: ${reasonLabel} — ${fullName}`;

    try {
      await this.emailProvider.send({
        to: CONTACT_TO_EMAIL,
        subject,
        html: this.buildHtml({ fullName, email, reasonLabel, description }),
        // Reply goes straight to the submitter, not our verified `from`.
        replyTo: email,
      });
    } catch (err) {
      this.logger.error(`Failed to send contact email: ${(err as Error).message}`);
      throw new HttpException(
        'Could not send your message right now. Please try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return { ok: true };
  }

  /**
   * Per-IP sliding-window limiter, same in-memory Map approach AuthService uses
   * for OTPs (no Redis/throttler package in this codebase yet — a restart
   * clears it, acceptable for abuse-throttling the same way it is for OTPs).
   */
  private enforceRateLimit(ip: string): void {
    const now = Date.now();
    const entry = this.rateStore.get(ip);

    if (!entry || now - entry.windowStart >= this.WINDOW_MS) {
      this.rateStore.set(ip, { count: 1, windowStart: now, lastAt: now });
      return;
    }
    if (now - entry.lastAt < this.COOLDOWN_MS) {
      throw new TooManyRequestsException('Please wait a moment before sending another message.');
    }
    if (entry.count >= this.MAX_PER_WINDOW) {
      throw new TooManyRequestsException('Too many messages sent. Please try again later.');
    }
    entry.count += 1;
    entry.lastAt = now;
  }

  /** All interpolated values are user-controlled → HTML-escaped so the email body can't be injected into. */
  private buildHtml(v: { fullName: string; email: string; reasonLabel: string; description: string }): string {
    const esc = this.escapeHtml;
    // Preserve the submitter's line breaks in the description.
    const descHtml = esc(v.description).replace(/\n/g, '<br>');
    return `
      <div style="font-family: system-ui, sans-serif; line-height: 1.6;">
        <h2 style="margin: 0 0 16px;">New contact form submission</h2>
        <p style="margin: 0 0 4px;"><strong>Name:</strong> ${esc(v.fullName)}</p>
        <p style="margin: 0 0 4px;"><strong>Email:</strong> ${esc(v.email)}</p>
        <p style="margin: 0 0 16px;"><strong>Reason:</strong> ${esc(v.reasonLabel)}</p>
        <p style="margin: 0 0 4px;"><strong>Message:</strong></p>
        <p style="margin: 0; white-space: pre-wrap;">${descHtml}</p>
      </div>
    `;
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
