import {
  track,
  trackAssessmentStarted,
  trackAssessmentSubmitted,
  trackBadgeEarned,
  trackLogin,
  trackSignUp,
  trackVerificationComplete,
} from './analyticsEvents';

type GtagWindow = Window & { gtag?: jest.Mock };

function withGtag(): jest.Mock {
  const gtag = jest.fn();
  (window as unknown as GtagWindow).gtag = gtag;
  return gtag;
}

function withoutGtag(): void {
  delete (window as unknown as GtagWindow).gtag;
}

describe('track()', () => {
  afterEach(() => withoutGtag());

  it('no-ops when window.gtag is undefined, and does not throw', () => {
    withoutGtag();
    expect(() => track('sign_up', { method: 'email_otp', role: 'candidate' })).not.toThrow();
  });

  it('no-ops without throwing even when gtag itself throws', () => {
    (window as unknown as GtagWindow).gtag = jest.fn(() => {
      throw new Error('gtag exploded');
    });
    expect(() => track('sign_up')).not.toThrow();
  });

  it('calls gtag with the event name and params when gtag is present (consent granted)', () => {
    const gtag = withGtag();
    track('badge_earned', { foo: 1 });
    expect(gtag).toHaveBeenCalledWith('event', 'badge_earned', { foo: 1 });
  });

  it('calls gtag with undefined params when none are passed', () => {
    const gtag = withGtag();
    track('badge_earned');
    expect(gtag).toHaveBeenCalledWith('event', 'badge_earned', undefined);
  });
});

describe('typed event helpers — no PII in any payload', () => {
  afterEach(() => withoutGtag());

  const PII_KEYS = ['email', 'phone', 'name', 'fullName', 'userId', 'id', 'profileId', 'orgName', 'organization'];

  function assertNoPiiKeys(params: Record<string, unknown> | undefined) {
    const keys = Object.keys(params ?? {});
    for (const key of keys) {
      expect(PII_KEYS).not.toContain(key);
    }
  }

  it('sign_up: method + role only', () => {
    const gtag = withGtag();
    trackSignUp('email_otp', 'candidate');
    expect(gtag).toHaveBeenCalledWith('event', 'sign_up', { method: 'email_otp', role: 'candidate' });
    assertNoPiiKeys(gtag.mock.calls[0][2]);
  });

  it('login: method + role only', () => {
    const gtag = withGtag();
    trackLogin('google', 'employer');
    expect(gtag).toHaveBeenCalledWith('event', 'login', { method: 'google', role: 'employer' });
    assertNoPiiKeys(gtag.mock.calls[0][2]);
  });

  it('verification_complete: method only', () => {
    const gtag = withGtag();
    trackVerificationComplete('phone_otp');
    expect(gtag).toHaveBeenCalledWith('event', 'verification_complete', { method: 'phone_otp' });
    assertNoPiiKeys(gtag.mock.calls[0][2]);
  });

  it('assessment_started: source only — never skill or level', () => {
    const gtag = withGtag();
    trackAssessmentStarted('self_serve');
    expect(gtag).toHaveBeenCalledWith('event', 'assessment_started', { source: 'self_serve' });
    const params = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(params)).toEqual(['source']);
    expect(params).not.toHaveProperty('skill');
    expect(params).not.toHaveProperty('level');
  });

  it('assessment_submitted: passed only, as a string — never skill or level', () => {
    const gtag = withGtag();
    trackAssessmentSubmitted(true);
    expect(gtag).toHaveBeenCalledWith('event', 'assessment_submitted', { passed: 'true' });
    const params = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(params)).toEqual(['passed']);
  });

  it('assessment_submitted: false maps to the string "false"', () => {
    const gtag = withGtag();
    trackAssessmentSubmitted(false);
    expect(gtag).toHaveBeenCalledWith('event', 'assessment_submitted', { passed: 'false' });
  });

  it('badge_earned: no parameters at all', () => {
    const gtag = withGtag();
    trackBadgeEarned();
    expect(gtag).toHaveBeenCalledWith('event', 'badge_earned', undefined);
  });
});
