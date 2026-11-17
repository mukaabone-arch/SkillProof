/** AI sourcing and outreach — shared types and labels (API: apps/api/src/modules/outreach). */

export type OutreachStatus = 'DRAFT' | 'SKIPPED' | 'SENT' | 'INTERESTED' | 'NOT_NOW' | 'NOT_INTERESTED' | 'STOPPED';
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type RecruiterContact = 'ANYONE' | 'VERIFIED_MATCHES' | 'OFF';
export type OutreachResponse = 'INTERESTED' | 'NOT_NOW' | 'NOT_INTERESTED';

export interface CampaignCounts {
  drafts: number;
  skipped: number;
  sent: number;
  awaiting: number;
  interested: number;
  notNow: number;
  notInterested: number;
  stopped: number;
}

export interface CampaignSummary {
  id: string;
  status: CampaignStatus;
  createdAt: string;
  job: { id: string; title: string; status: string };
  counts: CampaignCounts;
}

export interface CampaignMessage {
  id: string;
  candidateId: string;
  candidate: {
    ref: string;
    name: string | null;
    headline: string | null;
    roleTitle: string | null;
    roleTitleOther: string | null;
    yearsOfExp: number | null;
    location: string | null;
  };
  contact: { email: string | null; phone: string | null } | null;
  score: number;
  matchReason: string;
  body: string;
  status: OutreachStatus;
  sentAt: string | null;
  followUpsSent: number;
  nextFollowUpAt: string | null;
  respondedAt: string | null;
  candidateNote: string | null;
  shortlistEntryId: string | null;
}

export interface CampaignDetail {
  id: string;
  status: CampaignStatus;
  createdAt: string;
  followUpDays: number[];
  job: { id: string; title: string; status: string; client?: { id: string; name: string } | null; projectRoleId?: string | null };
  anonymised: boolean;
  limits: { dailyLimit: number; sentToday: number; remainingToday: number };
  counts: CampaignCounts;
  messages: CampaignMessage[];
}

export interface SendResult {
  sent: number;
  heldDailyLimit: number;
  heldWeeklyLimit: number;
  skipped: number;
}

export interface Opportunity {
  id: string;
  orgName: string;
  fromRecruiter: boolean;
  job: {
    id: string;
    title: string;
    live: boolean;
    employmentType: string;
    remote: boolean;
    location: string | null;
    salary: { min: number; max: number | null; currency: string } | null;
  };
  body: string;
  status: OutreachStatus;
  sentAt: string;
  respondedAt: string | null;
  candidateNote: string | null;
  canRespond: boolean;
}

export interface OutreachPreferences {
  recruiterContact: RecruiterContact;
  outreachWeeklyLimit: number;
  openToStaffing: boolean;
}

/** Recruiter-facing status words. */
export const MESSAGE_STATUS_LABEL: Record<OutreachStatus, string> = {
  DRAFT: 'Draft',
  SKIPPED: 'Left out',
  SENT: 'Awaiting reply',
  INTERESTED: 'Interested',
  NOT_NOW: 'Not now',
  NOT_INTERESTED: 'Not for them',
  STOPPED: 'Stopped',
};

export const MESSAGE_STATUS_VARIANT: Record<OutreachStatus, 'default' | 'verified' | 'danger' | 'warning' | 'neutral'> = {
  DRAFT: 'neutral',
  SKIPPED: 'neutral',
  SENT: 'default',
  INTERESTED: 'verified',
  NOT_NOW: 'warning',
  NOT_INTERESTED: 'danger',
  STOPPED: 'neutral',
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  CLOSED: 'Closed',
};

/** Candidate-facing words for their own answer. */
export const RESPONSE_LABEL: Record<OutreachStatus, string> = {
  DRAFT: '',
  SKIPPED: '',
  SENT: 'Waiting for your reply',
  INTERESTED: 'You said Interested',
  NOT_NOW: 'You said Not now',
  NOT_INTERESTED: 'You said Not for me',
  STOPPED: 'No longer taking replies',
};

export const CONTACT_OPTIONS: { value: RecruiterContact; label: string; hint: string }[] = [
  { value: 'ANYONE', label: 'Any role that matches my skills', hint: 'Verified employers and recruiters can message you about relevant roles.' },
  { value: 'VERIFIED_MATCHES', label: 'Only strong matches', hint: 'Only roles where your verified skills meet what the role asks for.' },
  { value: 'OFF', label: 'Don’t contact me', hint: 'No new messages. You can still apply to jobs yourself.' },
];

export function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatSalary(s: Opportunity['job']['salary']): string | null {
  if (!s) return null;
  const n = (v: number) => v.toLocaleString('en-IN');
  return `${s.currency} ${n(s.min)}${s.max ? `–${n(s.max)}` : '+'} a year`;
}
