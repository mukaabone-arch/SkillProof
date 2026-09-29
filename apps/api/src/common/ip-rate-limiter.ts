import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

/** NestJS has no built-in 429 exception — same one AuthService/ContactService each define locally. */
export class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Best-effort client IP for rate-limiting. `trust proxy` isn't enabled (see
 * main.ts), so req.ip is the proxy's address in production; the first hop of
 * X-Forwarded-For (set by Render/Vercel) is the real client. Falls back to
 * req.ip / the socket when the header is absent (local/dev). This only keys
 * a throttle — a spoofed header just buckets an attacker differently, it
 * can't bypass validation or auth. Lifted out of ContactController, which had
 * its own private copy of exactly this.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first?.trim() || req.ip || req.socket.remoteAddress || 'unknown') as string;
}

interface RateEntry {
  count: number;
  windowStart: number;
  lastAt: number;
}

/**
 * Per-key sliding-window limiter: a minimum cooldown between consecutive
 * hits plus a cap per rolling window, both per key (typically an IP — see
 * clientIp above). In-memory Map, same approach AuthService's OTP limiter
 * and ContactService's per-IP limiter already use independently (no Redis/
 * throttler package in this codebase yet — a restart clears it, acceptable
 * for abuse-throttling the same way it already is for those two). Pulled out
 * as a reusable class, unlike those two, so the next endpoint that needs
 * this (the OTP endpoints have the same gap — see AuthService's class doc)
 * doesn't have to copy-paste a third private implementation.
 */
export class InMemoryRateLimiter {
  private readonly store = new Map<string, RateEntry>();

  constructor(
    private readonly cooldownMs: number,
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
  ) {}

  /** Throws TooManyRequestsException if `key` is over its cooldown or window cap; otherwise records the hit. */
  hit(key: string, message = 'Too many requests. Please try again later.'): void {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.store.set(key, { count: 1, windowStart: now, lastAt: now });
      return;
    }
    if (now - entry.lastAt < this.cooldownMs) {
      throw new TooManyRequestsException(message);
    }
    if (entry.count >= this.maxPerWindow) {
      throw new TooManyRequestsException(message);
    }
    entry.count += 1;
    entry.lastAt = now;
  }
}
