import { BadRequestException } from '@nestjs/common';
import {
  assertCandidateVerified,
  isCandidateVerified,
  missingVerificationFields,
} from './candidate-verification-readiness';

describe('candidate-verification-readiness', () => {
  it.each([
    [{ phone: null, email: null }, ['phone', 'email']],
    [{ phone: '+15551234', email: null }, ['email']],
    [{ phone: null, email: 'a@b.com' }, ['phone']],
    [{ phone: '+15551234', email: 'a@b.com' }, []],
  ])('missingVerificationFields(%o) -> %o', (user, expected) => {
    expect(missingVerificationFields(user)).toEqual(expected);
  });

  it('isCandidateVerified is true only once both channels are present', () => {
    expect(isCandidateVerified({ phone: '+15551234', email: 'a@b.com' })).toBe(true);
    expect(isCandidateVerified({ phone: '+15551234', email: null })).toBe(false);
    expect(isCandidateVerified({ phone: null, email: null })).toBe(false);
  });

  it('assertCandidateVerified passes silently once both channels are present', () => {
    expect(() => assertCandidateVerified({ phone: '+15551234', email: 'a@b.com' })).not.toThrow();
  });

  it('assertCandidateVerified throws a machine-readable BadRequestException naming what is missing', () => {
    try {
      assertCandidateVerified({ phone: null, email: 'a@b.com' });
      fail('expected assertCandidateVerified to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse();
      expect(response).toMatchObject({ code: 'CANDIDATE_VERIFICATION_INCOMPLETE', missing: ['phone'] });
    }
  });

  it('lists both channels as missing when neither is set', () => {
    try {
      assertCandidateVerified({ phone: null, email: null });
      fail('expected assertCandidateVerified to throw');
    } catch (err) {
      const response = (err as BadRequestException).getResponse();
      expect(response).toMatchObject({ missing: ['phone', 'email'] });
    }
  });
});

describe('phone requirement by country', () => {
  const { missingVerificationFields, isCandidateVerified, phoneRequired, assertCandidateVerified } =
    jest.requireActual('./candidate-verification-readiness') as typeof import('./candidate-verification-readiness');

  it('requires a phone in India and when the country is unknown', () => {
    expect(phoneRequired({ country: 'IN' })).toBe(true);
    expect(phoneRequired({ country: null })).toBe(true);
    expect(phoneRequired({})).toBe(true);
    expect(missingVerificationFields({ phone: null, email: 'a@b.co', country: 'IN' })).toEqual(['phone']);
  });

  it('needs only a verified email outside India', () => {
    expect(phoneRequired({ country: 'AE' })).toBe(false);
    expect(isCandidateVerified({ phone: null, email: 'a@b.co', country: 'AE' })).toBe(true);
    expect(missingVerificationFields({ phone: null, email: null, country: 'GB' })).toEqual(['email']);
    expect(() => assertCandidateVerified({ phone: null, email: null, country: 'US' })).toThrow('Add and verify an email address to continue.');
  });
});
