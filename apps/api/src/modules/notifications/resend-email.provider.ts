import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailProvider, SendEmailParams } from './email-provider.interface';

const DEFAULT_FROM = 'SkillProof <notifications@skillproof.app>';

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly client: Resend;
  private readonly from: string;

  constructor() {
    this.client = new Resend(process.env.RESEND_API_KEY);
    this.from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  }

  async send({ to, subject, html }: SendEmailParams): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.from, to, subject, html });
    if (error) {
      this.logger.error(`Resend API error: ${error.name}`);
      throw new Error(error.message);
    }
  }
}
