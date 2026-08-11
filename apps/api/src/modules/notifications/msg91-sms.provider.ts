import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider, SendOtpSmsParams } from './sms-provider.interface';

/**
 * MSG91 SMS delivery via the Flow API (v5). Mirrors ResendEmailProvider:
 * reads its credentials from the environment in the constructor, exposes one
 * async send, and THROWS on any provider failure so the caller can surface it
 * (AuthService.sendOtpSms turns that throw into a 400 the candidate sees —
 * never a silent success).
 *
 * We generate/expire/rate-limit the OTP ourselves (AuthService.issueOtp), so
 * this uses MSG91's Flow (templated transactional SMS) API — which just
 * delivers a message built from a DLT-registered template — NOT MSG91's own
 * OTP API, which would generate a second, competing code.
 *
 * Env:
 *  - MSG91_AUTH_KEY   (required) account auth key
 *  - MSG91_TEMPLATE_ID(required) the DLT-registered flow/template id
 *  - MSG91_SENDER_ID  (optional) DLT header/sender, if the template needs it
 *  - MSG91_OTP_VAR    (optional) the template variable that receives the code
 *                     (defaults to "otp"); must match the registered template
 */
const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow/';

@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  private readonly logger = new Logger(Msg91SmsProvider.name);
  private readonly authKey = process.env.MSG91_AUTH_KEY;
  private readonly templateId = process.env.MSG91_TEMPLATE_ID;
  private readonly sender = process.env.MSG91_SENDER_ID;
  private readonly otpVar = process.env.MSG91_OTP_VAR || 'otp';

  async sendOtp({ to, otp }: SendOtpSmsParams): Promise<void> {
    if (!this.authKey || !this.templateId) {
      // A missing config in production must fail loudly, not look delivered.
      this.logger.error('MSG91 not configured (MSG91_AUTH_KEY / MSG91_TEMPLATE_ID missing).');
      throw new Error('SMS provider is not configured.');
    }

    // MSG91 wants country-code digits with no leading "+" or separators.
    const mobiles = to.replace(/\D/g, '');

    let res: Response;
    try {
      res = await fetch(MSG91_FLOW_URL, {
        method: 'POST',
        headers: { authkey: this.authKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          template_id: this.templateId,
          ...(this.sender ? { sender: this.sender } : {}),
          recipients: [{ mobiles, [this.otpVar]: otp }],
        }),
      });
    } catch (err) {
      // Network/DNS/timeout — never reached MSG91.
      this.logger.error(`MSG91 request failed: ${(err as Error).message}`);
      throw new Error('MSG91 request failed');
    }

    // MSG91 replies 200 with { type: 'success' | 'error', message }. Treat a
    // non-2xx OR type:'error' as a failure.
    let body: { type?: string; message?: unknown } | null = null;
    try {
      body = (await res.json()) as { type?: string; message?: unknown };
    } catch {
      // Non-JSON body — fall through to the status check below.
    }
    if (!res.ok || body?.type === 'error') {
      const detail = body?.message ? JSON.stringify(body.message) : `HTTP ${res.status}`;
      this.logger.error(`MSG91 send failed: ${detail}`);
      throw new Error(`MSG91 send failed: ${detail}`);
    }
  }
}
