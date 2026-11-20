import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

/**
 * Events an org can subscribe a webhook to. One name per thing that
 * happened; the payload's `data` carries the candidate package where a
 * candidate is involved (see CandidatePackageService).
 */
export const WEBHOOK_EVENTS = [
  'candidate.applied',
  'pipeline.stage_changed',
  'outreach.interested',
  'submission.status_changed',
  'job.status_changed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'webhook.test';

/** Which events make sense for which kind of org (recruiters have no shortlist; employers have no submissions). */
export const EVENTS_FOR_ORG_TYPE: Record<'EMPLOYER' | 'STAFFING', readonly WebhookEvent[]> = {
  EMPLOYER: ['candidate.applied', 'pipeline.stage_changed', 'outreach.interested', 'job.status_changed'],
  STAFFING: ['candidate.applied', 'outreach.interested', 'submission.status_changed', 'job.status_changed'],
};

export const MAX_WEBHOOKS_PER_ORG = 5;
export const MAX_API_KEYS_PER_ORG = 10;
/** Retry delays after a failed attempt (minutes); the delivery is FAILED after the last one. */
export const RETRY_DELAYS_MIN = [1, 5, 30, 120, 360];
/** An endpoint is switched off after this many failed deliveries in a row. */
export const WEBHOOK_DISABLE_AFTER = 20;
export const DELIVERY_TIMEOUT_MS = 10_000;
export const API_KEY_PREFIX = 'mya_';

/** A new signing secret ("whsec_" + 32 random bytes). */
export function newWebhookSecret(): string {
  return 'whsec_' + randomBytes(32).toString('base64url');
}

/** A new API key, its SHA-256 hash (what's stored) and the short prefix shown in lists. */
export function newApiKey(): { key: string; hash: string; prefix: string } {
  const key = API_KEY_PREFIX + randomBytes(24).toString('base64url');
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12) };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Signature header value: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>".
 * The timestamp lets receivers reject replays older than a few minutes.
 */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** Receiver-side check, exported for tests and the docs example. */
export function verifySignature(secret: string, body: string, header: string, toleranceSec = 300, now = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(signPayload(secret, body, t).split('v1=')[1]);
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Webhook URLs must be public HTTPS endpoints. Checked when saved (shape)
 * and again on every delivery against the resolved address (see
 * isPrivateAddress), so a hostname can't later point at our own network.
 */
export function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return 'Enter a full URL, starting with https://';
  }
  if (u.protocol !== 'https:') return 'Webhook URLs must use https://';
  if (u.username || u.password) return 'Remove the username and password from the URL.';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'Use a public address, not a local one.';
  }
  if (isIP(host) && isPrivateAddress(host)) return 'Use a public address, not a private network one.';
  return null;
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const a = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPrivateV4(mapped[1]);
    return (
      a === '::' ||
      a === '::1' ||
      a.startsWith('fc') ||
      a.startsWith('fd') ||
      a.startsWith('fe8') ||
      a.startsWith('fe9') ||
      a.startsWith('fea') ||
      a.startsWith('feb') ||
      a.startsWith('ff') ||
      a.startsWith('64:ff9b:') ||
      a.startsWith('2001:db8')
    );
  }
  return true;
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function retryAt(attempts: number, now = new Date()): Date | null {
  const delay = RETRY_DELAYS_MIN.at(attempts - 1);
  return delay == null ? null : new Date(now.getTime() + delay * 60_000);
}
