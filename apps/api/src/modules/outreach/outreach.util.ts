import { createHmac, timingSafeEqual } from 'crypto';
import { OutreachStatus, RecruiterContactPreference } from '@prisma/client';
import type { SkillMatchDetail } from '../jobs/scoring';

/** Same bands as MatchingService: below RELEVANT a candidate isn't worth a message at all. */
export const OUTREACH_MIN_SCORE = 25;
/** "Only roles matching my verified skills" — the score no all-unverified candidate can reach (see MatchingService). */
export const VERIFIED_MATCH_MIN = 50;
/** How many candidates one campaign drafts per run (create or "find more"). */
export const DRAFTS_PER_RUN = 25;
/** First-time messages one recruiter can send per rolling 24 hours. */
export const RECRUITER_DAILY_LIMIT = 50;
/** A candidate who said "Not for me" to an org isn't drafted by that org again for this long. */
export const DECLINED_COOLDOWN_DAYS = 90;
export const MAX_FOLLOW_UPS = 2;
export const WEEKLY_LIMIT_MIN = 1;
export const WEEKLY_LIMIT_MAX = 10;
export const MESSAGE_MAX_CHARS = 1200;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses where the candidate has received the message (sent, answered or stopped after sending). */
export const DELIVERED_STATUSES: OutreachStatus[] = [
  OutreachStatus.SENT,
  OutreachStatus.INTERESTED,
  OutreachStatus.NOT_NOW,
  OutreachStatus.NOT_INTERESTED,
  OutreachStatus.STOPPED,
];

export type OutreachResponse = 'INTERESTED' | 'NOT_NOW' | 'NOT_INTERESTED';

/** Whether this candidate's own setting lets a campaign reach them for a match of this score. */
export function contactAllowed(pref: RecruiterContactPreference, score: number): boolean {
  if (pref === RecruiterContactPreference.OFF) return false;
  if (pref === RecruiterContactPreference.VERIFIED_MATCHES) return score >= VERIFIED_MATCH_MIN;
  return score >= OUTREACH_MIN_SCORE;
}

/**
 * The one-line "why this candidate" shown to the recruiter. Built from the
 * match breakdown, not by the AI, so it can never claim a skill the
 * candidate doesn't hold. Matched entries are verified at/above the
 * required level by scoreCandidate's own definition.
 */
export function matchReason(matched: Pick<SkillMatchDetail, 'skillName' | 'candidateLevel'>[], missing: Pick<SkillMatchDetail, 'skillName'>[]): string {
  const parts: string[] = [];
  if (matched.length > 0) {
    parts.push('Verified ' + matched.slice(0, 3).map((m) => `${m.candidateLevel} ${m.skillName}`).join(', ') + (matched.length > 3 ? ` +${matched.length - 3} more` : ''));
  } else {
    parts.push('No verified match on this role’s skills yet');
  }
  if (missing.length > 0) {
    parts.push('missing ' + missing.slice(0, 2).map((m) => m.skillName).join(', ') + (missing.length > 2 ? ` +${missing.length - 2} more` : ''));
  }
  return parts.join('; ');
}

export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "{name}" placeholders in AI drafts become the candidate's first name, or "there". Kept out of the AI call so no name leaves MyAmbii. */
export function personalise(template: string, fullName: string | null | undefined): string {
  return template.replace(/\{name\}/g, firstName(fullName) ?? 'there');
}

/** Used when the AI draft fails: still a specific, honest message built from the same facts. */
export function fallbackMessage(input: {
  jobTitle: string;
  orgName: string;
  matchedSkills: { skillName: string; level: string }[];
  remote: boolean;
  location: string | null;
}): string {
  const skills = input.matchedSkills.slice(0, 2).map((s) => `${s.skillName} (verified ${s.level})`);
  const where = input.remote ? 'remote' : input.location ? `based in ${input.location}` : null;
  return [
    `Hi {name},`,
    '',
    `I'm hiring for a ${input.jobTitle} role at ${input.orgName}${where ? ` (${where})` : ''}.` +
      (skills.length ? ` Your verified ${skills.join(' and ')} on MyAmbii stood out.` : ''),
    '',
    `Would you be open to hearing more? Tap Interested and I'll share the details.`,
  ].join('\n');
}

export function nextFollowUpAt(from: Date, followUpDays: number[], followUpsSent: number): Date | null {
  if (followUpsSent >= Math.min(followUpDays.length, MAX_FOLLOW_UPS)) return null;
  const days = followUpDays.at(followUpsSent);
  return days == null ? null : new Date(from.getTime() + days * DAY_MS);
}

/** One-click unsubscribe link in outreach emails: HMAC of the user id, so it works without signing in. */
function unsubscribeSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function unsubscribeToken(userId: string): string {
  return createHmac('sha256', unsubscribeSecret()).update(`outreach-unsubscribe:${userId}`).digest('base64url');
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!userId || !token) return false;
  const expected = Buffer.from(unsubscribeToken(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Plain-text message → email-safe HTML paragraphs. */
export function messageToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
