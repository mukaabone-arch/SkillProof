import { StaffingSubmissionStatus } from '@prisma/client';

/** Representation lasts this long after the candidate consents, unless they're interviewing or have an offer. */
export const REPRESENTATION_DAYS = 30;
/** A placement keeps other companies away from that client for this long. */
export const PLACEMENT_PROTECTION_DAYS = 180;
/** How long the candidate has to approve a submission. */
export const CONSENT_TTL_HOURS = 72;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Legal-form words that don't distinguish one client from another ("Infosys Ltd" = "Infosys Limited"). */
const SUFFIXES = new Set([
  'the', 'pvt', 'private', 'ltd', 'limited', 'llp', 'llc', 'inc', 'incorporated', 'corp', 'corporation',
  'co', 'company', 'plc', 'gmbh', 'sa', 'ag', 'bv', 'pte',
]);

export function normaliseClientName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((w) => !SUFFIXES.has(w));
  return (kept.length ? kept : words).join(' ');
}

/** Bare host of a website ("https://www.acme.co.in/careers" → "acme.co.in"), or null. */
export function normaliseDomain(website: string | null | undefined): string | null {
  const raw = website?.trim();
  if (!raw) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export interface ClientKey {
  nameKey: string;
  domain: string | null;
}

export function sameClient(a: ClientKey, b: ClientKey): boolean {
  return a.nameKey === b.nameKey || (!!a.domain && a.domain === b.domain);
}

export type EffectiveSubmissionStatus = StaffingSubmissionStatus | 'EXPIRED';

export function effectiveSubmissionStatus(
  s: { status: StaffingSubmissionStatus; consentExpiresAt: Date },
  now = new Date(),
): EffectiveSubmissionStatus {
  return s.status === StaffingSubmissionStatus.PENDING_CONSENT && s.consentExpiresAt.getTime() <= now.getTime() ? 'EXPIRED' : s.status;
}

/**
 * Does this submission currently give its company the right to represent
 * the candidate to that client (and so block every other company)?
 */
export function isRepresentationActive(
  s: { status: StaffingSubmissionStatus; consentedAt: Date | null; statusUpdatedAt: Date },
  now = new Date(),
): boolean {
  switch (s.status) {
    case StaffingSubmissionStatus.SUBMITTED:
      return !!s.consentedAt && now.getTime() - s.consentedAt.getTime() < REPRESENTATION_DAYS * DAY_MS;
    case StaffingSubmissionStatus.INTERVIEWING:
    case StaffingSubmissionStatus.OFFER:
      return true;
    case StaffingSubmissionStatus.PLACED:
      return now.getTime() - s.statusUpdatedAt.getTime() < PLACEMENT_PROTECTION_DAYS * DAY_MS;
    default:
      return false;
  }
}

/** Status changes the staffing company may make. Consent decisions belong to the candidate. */
const ORG_TRANSITIONS: Partial<Record<StaffingSubmissionStatus, StaffingSubmissionStatus[]>> = {
  PENDING_CONSENT: ['WITHDRAWN'],
  SUBMITTED: ['INTERVIEWING', 'NOT_SELECTED', 'WITHDRAWN'],
  INTERVIEWING: ['OFFER', 'NOT_SELECTED', 'WITHDRAWN'],
  OFFER: ['PLACED', 'NOT_SELECTED', 'WITHDRAWN'],
};

export function orgCanMove(from: StaffingSubmissionStatus, to: StaffingSubmissionStatus): boolean {
  return (ORG_TRANSITIONS[from] ?? []).includes(to);
}

/** The candidate may withdraw their consent any time before a placement. */
export function candidateCanWithdraw(status: StaffingSubmissionStatus): boolean {
  return status === 'SUBMITTED' || status === 'INTERVIEWING' || status === 'OFFER';
}
