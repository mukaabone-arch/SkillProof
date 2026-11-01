import { AvailabilityStatus, Prisma, RateUnit, StaffingRequestStatus, WorkType } from '@prisma/client';

/** Availability older than this is hidden from staffing search until the candidate re-confirms it. */
export const AVAILABILITY_FRESH_DAYS = 30;
/** How long a candidate has to answer an availability request. */
export const REQUEST_TTL_HOURS = 48;
/** Spam limits: requests one company can send per rolling week, and requests one candidate can receive per week (all companies). */
export const ORG_WEEKLY_REQUEST_LIMIT = 100;
export const CANDIDATE_WEEKLY_REQUEST_LIMIT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export type EffectiveRequestStatus = StaffingRequestStatus | 'EXPIRED';

/** A PENDING request past its expiry reads as EXPIRED — never stored, so no sweep job. */
export function effectiveStatus(r: { status: StaffingRequestStatus; expiresAt: Date }, now = new Date()): EffectiveRequestStatus {
  return r.status === StaffingRequestStatus.PENDING && r.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : r.status;
}

/** Contact details are shared only after the candidate says yes (with or without conditions). */
export function revealsContact(status: EffectiveRequestStatus): boolean {
  return status === StaffingRequestStatus.AVAILABLE || status === StaffingRequestStatus.CONDITIONAL;
}

export function isAvailabilityFresh(confirmedAt: Date | null, now = new Date()): boolean {
  return !!confirmedAt && now.getTime() - confirmedAt.getTime() <= AVAILABILITY_FRESH_DAYS * DAY_MS;
}

export interface AvailabilityInput {
  openToStaffing: boolean;
  availabilityStatus?: AvailabilityStatus | null;
  availableFrom?: string | null;
  noticePeriodDays?: number | null;
  workTypes?: WorkType[] | null;
  expectedRateMinInr?: number | null;
  expectedRateMaxInr?: number | null;
  expectedRateUnit?: RateUnit | null;
}

/**
 * Validates and normalises a candidate's availability save. Opting out keeps
 * the details (so opting back in is one click) but stops all visibility.
 * Opting in requires a status, the field that status depends on, and at
 * least one work type. Saving while opted in counts as confirming it.
 * Returns an error message instead of throwing, so the caller picks the HTTP shape.
 */
export function normaliseAvailability(
  input: AvailabilityInput,
  now = new Date(),
): { data: Prisma.CandidateProfileUpdateInput } | { error: string } {
  const status = input.availabilityStatus ?? null;
  const workTypes = [...new Set(input.workTypes ?? [])];
  const min = input.expectedRateMinInr ?? null;
  const max = input.expectedRateMaxInr ?? null;

  if (input.openToStaffing) {
    if (!status) return { error: 'Choose your availability.' };
    if (workTypes.length === 0) return { error: 'Choose at least one type of work.' };
  }
  let availableFrom: Date | null = null;
  if (status === AvailabilityStatus.AVAILABLE_FROM) {
    if (!input.availableFrom) return { error: 'Add the date you can start from.' };
    availableFrom = new Date(input.availableFrom);
    if (Number.isNaN(availableFrom.getTime())) return { error: 'That start date is not valid.' };
  }
  let noticePeriodDays: number | null = null;
  if (status === AvailabilityStatus.NOTICE_PERIOD) {
    if (input.noticePeriodDays == null) return { error: 'Add your notice period in days.' };
    noticePeriodDays = input.noticePeriodDays;
  }
  if (min != null && max != null && min > max) return { error: 'The minimum rate is higher than the maximum.' };
  if ((min != null || max != null) && !input.expectedRateUnit) return { error: 'Choose whether the rate is per year, month, day or hour.' };

  return {
    data: {
      openToStaffing: input.openToStaffing,
      availabilityStatus: status,
      availableFrom,
      noticePeriodDays,
      workTypes,
      expectedRateMinInr: min,
      expectedRateMaxInr: max,
      expectedRateUnit: min != null || max != null ? input.expectedRateUnit ?? null : null,
      ...(input.openToStaffing ? { availabilityConfirmedAt: now } : {}),
    },
  };
}

/** "Can start within N days" as a Prisma condition over the three availability shapes. */
export function availableWithinWhere(days: number, now = new Date()): Prisma.CandidateProfileWhereInput {
  return {
    OR: [
      { availabilityStatus: AvailabilityStatus.AVAILABLE_NOW },
      { availabilityStatus: AvailabilityStatus.AVAILABLE_FROM, availableFrom: { lte: new Date(now.getTime() + days * DAY_MS) } },
      { availabilityStatus: AvailabilityStatus.NOTICE_PERIOD, noticePeriodDays: { lte: days } },
    ],
  };
}

/** Short, non-identifying reference shown to staffing companies before contact is shared. */
export function candidateRef(profileId: string): string {
  return 'C-' + profileId.replace(/-/g, '').slice(0, 6).toUpperCase();
}
