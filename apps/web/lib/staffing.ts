/** Shared labels/formatting for the staffing-company features (candidate + staffing portal). */

export type WorkType = 'PERMANENT' | 'CONTRACT' | 'CONTRACT_TO_HIRE';
export type AvailabilityStatus = 'AVAILABLE_NOW' | 'AVAILABLE_FROM' | 'NOTICE_PERIOD' | 'NOT_LOOKING';
export type RateUnit = 'ANNUAL' | 'MONTHLY' | 'DAILY' | 'HOURLY';
export type RequestStatus = 'PENDING' | 'AVAILABLE' | 'CONDITIONAL' | 'NOT_NOW' | 'WITHDRAWN' | 'EXPIRED';

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  PERMANENT: 'Permanent',
  CONTRACT: 'Contract',
  CONTRACT_TO_HIRE: 'Contract-to-hire',
};
export const WORK_TYPES = Object.keys(WORK_TYPE_LABEL) as WorkType[];

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  AVAILABLE_NOW: 'Available now',
  AVAILABLE_FROM: 'Available from a date',
  NOTICE_PERIOD: 'Serving / will serve a notice period',
  NOT_LOOKING: 'Not looking right now',
};

export const RATE_UNIT_LABEL: Record<RateUnit, string> = {
  ANNUAL: 'per year',
  MONTHLY: 'per month',
  DAILY: 'per day',
  HOURLY: 'per hour',
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Waiting for reply',
  AVAILABLE: 'Available',
  CONDITIONAL: 'Interested, with conditions',
  NOT_NOW: 'Not right now',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Expired',
};

export const ROLE_TITLE_LABEL: Record<string, string> = {
  AI_ENGINEER: 'AI Engineer',
  ML_ENGINEER: 'ML Engineer',
  PROMPT_ENGINEER: 'Prompt Engineer',
  DATA_SCIENTIST: 'Data Scientist',
  MLOPS_ENGINEER: 'MLOps Engineer',
  NLP_ENGINEER: 'NLP Engineer',
  COMPUTER_VISION_ENGINEER: 'Computer Vision Engineer',
  RESEARCH_ENGINEER: 'Research Engineer',
  DATA_ENGINEER: 'Data Engineer',
  AI_PRODUCT_MANAGER: 'AI Product Manager',
  OTHER: 'Other role',
};

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

export function formatRate(min: number | null, max: number | null, unit: RateUnit | null): string | null {
  if (min == null && max == null) return null;
  const range = min != null && max != null ? `${inr(min)}–${inr(max)}` : min != null ? `from ${inr(min)}` : `up to ${inr(max!)}`;
  return unit ? `${range} ${RATE_UNIT_LABEL[unit]}` : range;
}

export function formatAvailability(a: {
  availabilityStatus: AvailabilityStatus | null;
  availableFrom: string | null;
  noticePeriodDays: number | null;
}): string {
  switch (a.availabilityStatus) {
    case 'AVAILABLE_NOW':
      return 'Available now';
    case 'AVAILABLE_FROM':
      return a.availableFrom
        ? `Available from ${new Date(a.availableFrom).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : 'Available from a date';
    case 'NOTICE_PERIOD':
      return a.noticePeriodDays != null ? `${a.noticePeriodDays}-day notice period` : 'Notice period';
    case 'NOT_LOOKING':
      return 'Not looking right now';
    default:
      return 'Not set';
  }
}

export function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

// ---- Phase 2a: submissions ----

export type SubmissionStatus =
  | 'PENDING_CONSENT'
  | 'DECLINED'
  | 'SUBMITTED'
  | 'INTERVIEWING'
  | 'OFFER'
  | 'PLACED'
  | 'NOT_SELECTED'
  | 'WITHDRAWN'
  | 'EXPIRED';

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  PENDING_CONSENT: 'Waiting for candidate approval',
  DECLINED: 'Candidate declined',
  SUBMITTED: 'Submitted to client',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer',
  PLACED: 'Placed',
  NOT_SELECTED: 'Not selected',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Approval expired',
};

/** Next steps the staffing company can take from each status (mirrors the API's orgCanMove). */
export const SUBMISSION_NEXT: Partial<Record<SubmissionStatus, SubmissionStatus[]>> = {
  PENDING_CONSENT: ['WITHDRAWN'],
  SUBMITTED: ['INTERVIEWING', 'NOT_SELECTED', 'WITHDRAWN'],
  INTERVIEWING: ['OFFER', 'NOT_SELECTED', 'WITHDRAWN'],
  OFFER: ['PLACED', 'NOT_SELECTED', 'WITHDRAWN'],
};

export const SUBMISSION_ACTION_LABEL: Partial<Record<SubmissionStatus, string>> = {
  INTERVIEWING: 'Mark interviewing',
  OFFER: 'Mark offer',
  PLACED: 'Mark placed',
  NOT_SELECTED: 'Not selected',
  WITHDRAWN: 'Withdraw',
};
