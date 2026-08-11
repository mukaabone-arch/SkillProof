import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ContactSubmissionDto } from './contact.dto';
import { ContactService } from './contact.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /**
   * Public, unauthenticated marketing contact form — no JwtAuthGuard by
   * design. The global ValidationPipe validates the DTO; ContactService adds
   * the honeypot check and per-IP rate limit (both live there, not here).
   */
  @Post()
  @HttpCode(200)
  submit(@Req() req: Request, @Body() dto: ContactSubmissionDto) {
    return this.contact.submit(dto, this.clientIp(req));
  }

  /**
   * Best-effort client IP for rate-limiting. `trust proxy` isn't enabled (see
   * main.ts), so req.ip is the proxy's address in production; the first hop of
   * X-Forwarded-For (set by Render/Vercel) is the real client. Falls back to
   * req.ip / the socket when the header is absent (local/dev). This only keys
   * a throttle — a spoofed header just buckets an attacker differently, it
   * can't bypass validation or the honeypot.
   */
  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    return (first?.trim() || req.ip || req.socket.remoteAddress || 'unknown') as string;
  }
}
