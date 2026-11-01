import { AvailabilityStatus, RateUnit, StaffingRequestStatus, WorkType } from '@prisma/client';
import { candidateRef, effectiveStatus, isAvailabilityFresh, normaliseAvailability, reminderDue, revealsContact } from './staffing.util';

const NOW = new Date('2026-11-01T10:00:00Z');

describe('effectiveStatus / revealsContact', () => {
  it('reads an overdue PENDING request as EXPIRED and leaves answered ones alone', () => {
    expect(effectiveStatus({ status: StaffingRequestStatus.PENDING, expiresAt: new Date('2026-11-01T09:00:00Z') }, NOW)).toBe('EXPIRED');
    expect(effectiveStatus({ status: StaffingRequestStatus.PENDING, expiresAt: new Date('2026-11-02T09:00:00Z') }, NOW)).toBe('PENDING');
    expect(effectiveStatus({ status: StaffingRequestStatus.AVAILABLE, expiresAt: new Date('2026-10-01T09:00:00Z') }, NOW)).toBe('AVAILABLE');
  });
  it('shares contact details only after a yes', () => {
    expect(revealsContact('AVAILABLE')).toBe(true);
    expect(revealsContact('CONDITIONAL')).toBe(true);
    expect(revealsContact('PENDING')).toBe(false);
    expect(revealsContact('EXPIRED')).toBe(false);
    expect(revealsContact('NOT_NOW')).toBe(false);
  });
});

describe('normaliseAvailability', () => {
  it('requires a status and a work type to opt in', () => {
    expect(normaliseAvailability({ openToStaffing: true }, NOW)).toEqual({ error: 'Choose your availability.' });
    expect(normaliseAvailability({ openToStaffing: true, availabilityStatus: AvailabilityStatus.AVAILABLE_NOW }, NOW)).toEqual({
      error: 'Choose at least one type of work.',
    });
  });

  it('keeps only the field the status needs and stamps the confirmation', () => {
    const r = normaliseAvailability(
      {
        openToStaffing: true,
        availabilityStatus: AvailabilityStatus.NOTICE_PERIOD,
        noticePeriodDays: 30,
        availableFrom: '2026-12-01',
        workTypes: [WorkType.CONTRACT, WorkType.CONTRACT],
        expectedRateMinInr: 8000,
        expectedRateMaxInr: 10000,
        expectedRateUnit: RateUnit.DAILY,
      },
      NOW,
    );
    expect(r).toEqual({
      data: expect.objectContaining({
        noticePeriodDays: 30,
        availableFrom: null,
        workTypes: [WorkType.CONTRACT],
        expectedRateUnit: RateUnit.DAILY,
        availabilityConfirmedAt: NOW,
      }),
    });
  });

  it('rejects a min rate above the max, and a rate without a unit', () => {
    const base = { openToStaffing: true, availabilityStatus: AvailabilityStatus.AVAILABLE_NOW, workTypes: [WorkType.PERMANENT] };
    expect(normaliseAvailability({ ...base, expectedRateMinInr: 9, expectedRateMaxInr: 5, expectedRateUnit: RateUnit.ANNUAL }, NOW)).toHaveProperty('error');
    expect(normaliseAvailability({ ...base, expectedRateMinInr: 9 }, NOW)).toHaveProperty('error');
  });

  it('lets a candidate opt out without filling anything in', () => {
    expect(normaliseAvailability({ openToStaffing: false }, NOW)).toHaveProperty('data');
  });
});

describe('freshness and refs', () => {
  it('treats availability older than 30 days as stale', () => {
    expect(isAvailabilityFresh(new Date('2026-10-15T10:00:00Z'), NOW)).toBe(true);
    expect(isAvailabilityFresh(new Date('2026-09-15T10:00:00Z'), NOW)).toBe(false);
    expect(isAvailabilityFresh(null, NOW)).toBe(false);
  });
  it('makes a short stable ref', () => {
    expect(candidateRef('ab12cd34-0000-4000-8000-000000000000')).toBe('C-AB12CD');
  });
});

describe('reminderDue', () => {
  const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  it('waits until four days before availability goes stale', () => {
    expect(reminderDue(day(20), null, NOW)).toBe(false);
    expect(reminderDue(day(27), null, NOW)).toBe(true);
    expect(reminderDue(day(40), null, NOW)).toBe(true);
  });
  it('sends once per confirmation', () => {
    expect(reminderDue(day(27), day(1), NOW)).toBe(false);
    expect(reminderDue(day(27), day(30), NOW)).toBe(true);
    expect(reminderDue(null, null, NOW)).toBe(false);
  });
});
