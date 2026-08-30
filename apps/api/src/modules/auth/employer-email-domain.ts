import { BadRequestException } from '@nestjs/common';
import disposableDomains from './disposable-email-domains.json';

/**
 * Employer-only signup gate: rejects free consumer webmail and disposable/
 * temp-mail domains, so a new employer org can't be created on an address
 * that isn't a real company mailbox. Two tiers, kept deliberately separate
 * (see each const's own doc comment) rather than one merged list, because
 * they have different maintenance stories.
 *
 * NOT applied to candidates anywhere (see AuthService — only the employer
 * signup/link call sites reach assertCompanyEmail), and NOT applied to
 * existing accounts logging in (see requestEmailOtp/verifyEmailOtp's own
 * `existing`-gated calls) — this is a signup-time gate, not a login gate.
 */

/**
 * Major free consumer email providers — hand-curated, not vendored. This
 * list is short and essentially static (a new major free-mail provider
 * launching is a rare event, unlike disposable/temp-mail domains below,
 * which appear constantly) — there's no benefit to an external dependency
 * for ~35 well-known domains, and keeping it as a plain in-repo array means
 * every entry is reviewable in a normal PR diff rather than living inside
 * someone else's list. Every domain below is a real, currently-operating
 * (or still-resolving legacy) free-mail service — none invented.
 *
 * To add a domain: append it below (lowercase, no leading '.'). To remove
 * one (e.g. a false-positive report from a legitimate company using an
 * unusual-looking domain): delete the line. No build step required either
 * way — see isFreeOrDisposableEmailDomain for how this is matched.
 */
const FREE_EMAIL_DOMAINS: readonly string[] = [
  // Global majors
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  // Privacy-focused
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'fastmail.com',
  'tutanota.com',
  'hushmail.com',
  // India-common
  'yahoo.co.in',
  'rediffmail.com',
  'sify.com',
  'in.com',
  'indiatimes.com',
  'zoho.in',
  // Zoho (global — zoho.in above is its distinct India-specific domain)
  'zoho.com',
  'zohomail.com',
  // Russia/CIS
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  // China
  'qq.com',
  '163.com',
  '126.com',
];

/**
 * Disposable/temp-mail domains — vendored snapshot, not hand-maintained.
 * This space is large (tens of thousands of domains) and genuinely
 * volatile — new temp-mail services appear constantly, so a hand-curated
 * list would go stale within weeks and quietly stop catching new ones. A
 * live npm dependency was deliberately rejected instead: every other
 * dependency in this API is a real integration (S3, Anthropic, Razorpay,
 * Resend); pulling in someone else's unreviewed data on every `npm
 * install`, straight onto a signup gate, isn't a trade this project makes
 * elsewhere and shouldn't start here. A vendored static file gets the same
 * coverage with a reviewable diff and no supply-chain surface.
 *
 * Source: https://github.com/disposable-email-domains/disposable-email-domains
 *   File: disposable_email_blocklist.conf
 *   License: MIT
 *   Snapshotted: commit 5cf2e6d4cf63 (2026-08-19), 8322 domains.
 *
 * To refresh: re-fetch the same file, diff it against this one, and
 * replace wholesale —
 *   curl -s https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf \
 *     | python3 -c "import json,sys; print(json.dumps(sorted(set(l.strip().lower() for l in sys.stdin if l.strip() and not l.startswith('#')))))" \
 *     > disposable-email-domains.json
 * then update the snapshot commit/date/count above and re-run
 * employer-email-domain.spec.ts. No fixed cadence — refresh whenever a
 * real disposable domain is reported as slipping through.
 */
const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = disposableDomains;

const BLOCKED_DOMAINS: ReadonlySet<string> = new Set([...FREE_EMAIL_DOMAINS, ...DISPOSABLE_EMAIL_DOMAINS]);

/**
 * True if `domain` is blocked directly, or is a subdomain of a blocked
 * domain (mail.gmail.com → blocked, via the gmail.com entry). Deliberately
 * NOT a substring/`.includes()` check — that would false-positive on any
 * legitimate domain that merely contains a blocked name as a substring
 * (e.g. "notgmail.com" must stay allowed). The '.' prefix on the suffix
 * check is what makes this a domain-boundary match rather than a string-
 * boundary one — "evilgmail.com" doesn't end with ".gmail.com" and so
 * isn't caught either, only genuine subdomains are.
 */
function isBlockedDomain(domain: string): boolean {
  if (BLOCKED_DOMAINS.has(domain)) return true;
  for (const blocked of BLOCKED_DOMAINS) {
    if (domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

/**
 * Expects an already-normalized (normalizeEmail) address — case-sensitivity
 * and whitespace are the caller's job, this only ever compares the domain
 * part. Malformed input (no '@') is treated as non-blocked; DTO-level
 * @IsEmail() has already rejected anything that shape by the time this runs.
 */
export function isFreeOrDisposableEmailDomain(email: string): boolean {
  const domain = email.split('@')[1];
  if (!domain) return false;
  return isBlockedDomain(domain);
}

/**
 * Thrown at employer signup (never login — see AuthService's `existing`-
 * gated call sites) when the email's domain is a free consumer provider or
 * a known disposable/temp-mail domain. `code` follows the same
 * machine-readable convention as ORG_SETUP_INCOMPLETE/LIMIT_REACHED, so a
 * client could special-case it later, though today's frontend already
 * renders `message` as-is with no special handling needed (see
 * EmployerOtpLogin.tsx / OAuthCallback.tsx's generic error display).
 */
export function assertCompanyEmail(email: string): void {
  if (!isFreeOrDisposableEmailDomain(email)) return;

  throw new BadRequestException({
    code: 'COMPANY_EMAIL_REQUIRED',
    message:
      "Please use your company email address. Free email providers (Gmail, Yahoo, Outlook, etc.) and disposable/temporary addresses aren't accepted for employer accounts.",
  });
}

/**
 * Team-invite counterpart to assertCompanyEmail above — same underlying
 * check (isFreeOrDisposableEmailDomain), same COMPANY_EMAIL_REQUIRED code,
 * different message. Two call sites, both deliberate:
 *
 *  - OrgMembersService.invite — UX-only, catches the mistake immediately
 *    for the inviting admin rather than making the invitee discover it
 *    later.
 *  - AuthService.acceptInvite — the real boundary. A PENDING row somehow
 *    carrying a blocked domain (e.g. a future bug in invite-time
 *    validation, or a row from before this check existed) must not be
 *    honoured on a technicality just because invite-time didn't catch it.
 *
 * No grandfathering needed for either: checked in production before this
 * shipped — the only employer account on record is info@flairfuture.com
 * (a company domain), and there were zero PENDING OrgInvitation rows to
 * begin with, so nothing in flight is invalidated. (A separate account,
 * mukaabone@gmail.com, is PLATFORM_ADMIN with no org membership and never
 * goes through either invite call site — irrelevant here regardless.)
 */
export function assertCompanyEmailForInvite(email: string): void {
  if (!isFreeOrDisposableEmailDomain(email)) return;

  throw new BadRequestException({
    code: 'COMPANY_EMAIL_REQUIRED',
    message: 'Team members must be invited using a company email address.',
  });
}
