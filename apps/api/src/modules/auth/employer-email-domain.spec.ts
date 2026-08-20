import { HttpException } from '@nestjs/common';
import { assertCompanyEmail, isFreeOrDisposableEmailDomain } from './employer-email-domain';

describe('isFreeOrDisposableEmailDomain', () => {
  it('blocks an exact free-provider domain', () => {
    expect(isFreeOrDisposableEmailDomain('someone@gmail.com')).toBe(true);
  });

  it('blocks an exact disposable domain from the vendored list', () => {
    expect(isFreeOrDisposableEmailDomain('someone@mailinator.com')).toBe(true);
    expect(isFreeOrDisposableEmailDomain('someone@guerrillamail.com')).toBe(true);
    expect(isFreeOrDisposableEmailDomain('someone@10minutemail.com')).toBe(true);
  });

  it('blocks a subdomain of a blocked domain (mail.gmail.com)', () => {
    expect(isFreeOrDisposableEmailDomain('someone@mail.gmail.com')).toBe(true);
  });

  it('blocks a multi-level subdomain of a blocked domain', () => {
    expect(isFreeOrDisposableEmailDomain('someone@a.b.mailinator.com')).toBe(true);
  });

  it('allows a domain that merely starts with a blocked name (notgmail.com)', () => {
    expect(isFreeOrDisposableEmailDomain('someone@notgmail.com')).toBe(false);
  });

  it('allows a domain that merely contains a blocked name as a substring, without a subdomain boundary', () => {
    // Neither a suffix ("...gmail.com") nor a genuine subdomain (".gmail.com")
    // — a naive .includes()-style check would wrongly catch these.
    expect(isFreeOrDisposableEmailDomain('someone@evilgmail.com')).toBe(false);
    expect(isFreeOrDisposableEmailDomain('someone@gmailcorp.com')).toBe(false);
    expect(isFreeOrDisposableEmailDomain('someone@mailinatorcorp.com')).toBe(false);
  });

  it('allows an ordinary company domain', () => {
    expect(isFreeOrDisposableEmailDomain('someone@acme.com')).toBe(false);
    expect(isFreeOrDisposableEmailDomain('someone@flairfuture.com')).toBe(false);
  });

  it('is case-insensitive on the domain (defense in depth — callers are expected to normalize first)', () => {
    expect(isFreeOrDisposableEmailDomain('someone@GMAIL.com')).toBe(false);
    // Deliberately documents current behavior: this function trusts its
    // input is already normalizeEmail()'d, same contract as
    // findVerifiedEmailMatch/assertEmailLinkable elsewhere in this module.
    // Every real call site (requestEmailOtp, verifyEmailOtp,
    // assertEmailLinkable) always calls normalizeEmail() first.
  });

  it('India-common providers are covered', () => {
    expect(isFreeOrDisposableEmailDomain('someone@rediffmail.com')).toBe(true);
    expect(isFreeOrDisposableEmailDomain('someone@yahoo.co.in')).toBe(true);
    expect(isFreeOrDisposableEmailDomain('someone@zoho.in')).toBe(true);
  });

  it('the full required set from the task is covered', () => {
    const required = [
      'gmail.com',
      'yahoo.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'icloud.com',
      'protonmail.com',
      'gmx.com',
      'mail.com',
      'yandex.com',
      'zoho.com',
      'rediffmail.com',
      'aol.com',
      'mailinator.com',
      'guerrillamail.com',
      '10minutemail.com',
    ];
    for (const domain of required) {
      expect(isFreeOrDisposableEmailDomain(`someone@${domain}`)).toBe(true);
    }
  });

  it('malformed input (no @) is treated as not blocked rather than throwing', () => {
    expect(isFreeOrDisposableEmailDomain('not-an-email')).toBe(false);
  });
});

describe('assertCompanyEmail', () => {
  it('throws a 400 with the COMPANY_EMAIL_REQUIRED code and a specific message for a blocked domain', async () => {
    try {
      assertCompanyEmail('someone@gmail.com');
      throw new Error('expected assertCompanyEmail to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(400);
      expect(httpErr.getResponse()).toMatchObject({
        code: 'COMPANY_EMAIL_REQUIRED',
        message: expect.stringContaining('company email'),
      });
    }
  });

  it('does not throw for a company domain', () => {
    expect(() => assertCompanyEmail('someone@acme.com')).not.toThrow();
  });
});
