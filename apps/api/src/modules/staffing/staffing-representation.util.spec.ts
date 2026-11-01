import { StaffingSubmissionStatus as S } from '@prisma/client';
import {
  candidateCanWithdraw,
  effectiveSubmissionStatus,
  isRepresentationActive,
  normaliseClientName,
  normaliseDomain,
  orgCanMove,
  sameClient,
} from './staffing-representation.util';

const NOW = new Date('2026-11-01T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('client matching', () => {
  it('ignores legal suffixes, case and punctuation', () => {
    expect(normaliseClientName('Infosys Ltd.')).toBe('infosys');
    expect(normaliseClientName('INFOSYS LIMITED')).toBe('infosys');
    expect(normaliseClientName('Tata Consultancy Services Pvt. Ltd')).toBe('tata consultancy services');
    expect(normaliseClientName('The Company')).toBe('the company'); // all suffix words → keep them rather than an empty key
  });
  it('reduces a website to its bare host', () => {
    expect(normaliseDomain('https://www.acme.co.in/careers')).toBe('acme.co.in');
    expect(normaliseDomain('acme.com')).toBe('acme.com');
    expect(normaliseDomain('')).toBeNull();
  });
  it('treats the same name or the same domain as the same client', () => {
    expect(sameClient({ nameKey: 'acme', domain: null }, { nameKey: 'acme', domain: 'x.com' })).toBe(true);
    expect(sameClient({ nameKey: 'acme', domain: 'acme.com' }, { nameKey: 'acme india', domain: 'acme.com' })).toBe(true);
    expect(sameClient({ nameKey: 'acme', domain: null }, { nameKey: 'globex', domain: null })).toBe(false);
  });
});

describe('representation window', () => {
  it('lasts 30 days from consent while only submitted', () => {
    expect(isRepresentationActive({ status: S.SUBMITTED, consentedAt: daysAgo(10), statusUpdatedAt: daysAgo(10) }, NOW)).toBe(true);
    expect(isRepresentationActive({ status: S.SUBMITTED, consentedAt: daysAgo(31), statusUpdatedAt: daysAgo(31) }, NOW)).toBe(false);
  });
  it('holds while interviewing or at offer, and protects a placement for 180 days', () => {
    expect(isRepresentationActive({ status: S.INTERVIEWING, consentedAt: daysAgo(90), statusUpdatedAt: daysAgo(60) }, NOW)).toBe(true);
    expect(isRepresentationActive({ status: S.PLACED, consentedAt: daysAgo(200), statusUpdatedAt: daysAgo(100) }, NOW)).toBe(true);
    expect(isRepresentationActive({ status: S.PLACED, consentedAt: daysAgo(300), statusUpdatedAt: daysAgo(200) }, NOW)).toBe(false);
    expect(isRepresentationActive({ status: S.DECLINED, consentedAt: null, statusUpdatedAt: daysAgo(1) }, NOW)).toBe(false);
  });
  it('reads overdue consent as expired', () => {
    expect(effectiveSubmissionStatus({ status: S.PENDING_CONSENT, consentExpiresAt: daysAgo(1) }, NOW)).toBe('EXPIRED');
  });
});

describe('who can move a submission', () => {
  it('lets the company progress it but never consent on the candidate’s behalf', () => {
    expect(orgCanMove(S.SUBMITTED, S.INTERVIEWING)).toBe(true);
    expect(orgCanMove(S.OFFER, S.PLACED)).toBe(true);
    expect(orgCanMove(S.PENDING_CONSENT, S.SUBMITTED)).toBe(false);
    expect(orgCanMove(S.PLACED, S.WITHDRAWN)).toBe(false);
  });
  it('lets the candidate withdraw before placement only', () => {
    expect(candidateCanWithdraw(S.INTERVIEWING)).toBe(true);
    expect(candidateCanWithdraw(S.PLACED)).toBe(false);
  });
});
