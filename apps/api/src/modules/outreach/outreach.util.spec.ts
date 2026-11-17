import { RecruiterContactPreference } from '@prisma/client';
import {
  contactAllowed,
  fallbackMessage,
  matchReason,
  messageToHtml,
  nextFollowUpAt,
  personalise,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from './outreach.util';

describe('outreach.util', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
  });

  it('respects the candidate setting: off, verified matches only, or anyone above the relevance bar', () => {
    expect(contactAllowed(RecruiterContactPreference.OFF, 95)).toBe(false);
    expect(contactAllowed(RecruiterContactPreference.VERIFIED_MATCHES, 49)).toBe(false);
    expect(contactAllowed(RecruiterContactPreference.VERIFIED_MATCHES, 50)).toBe(true);
    expect(contactAllowed(RecruiterContactPreference.ANYONE, 24)).toBe(false);
    expect(contactAllowed(RecruiterContactPreference.ANYONE, 25)).toBe(true);
  });

  it('builds the match reason from the breakdown only', () => {
    expect(
      matchReason(
        [
          { skillName: 'Python', candidateLevel: 'L3' },
          { skillName: 'RAG Systems', candidateLevel: 'L2' },
        ],
        [{ skillName: 'Kubernetes' }],
      ),
    ).toBe('Verified L3 Python, L2 RAG Systems; missing Kubernetes');
    expect(matchReason([], [{ skillName: 'A' }, { skillName: 'B' }, { skillName: 'C' }])).toBe(
      'No verified match on this role’s skills yet; missing A, B +1 more',
    );
  });

  it('fills the name placeholder with a first name, or "there"', () => {
    expect(personalise('Hi {name},', 'Priya Sharma')).toBe('Hi Priya,');
    expect(personalise('Hi {name},', null)).toBe('Hi there,');
  });

  it('fallback message names the role, company and verified skills, never pay', () => {
    const m = fallbackMessage({ jobTitle: 'ML Engineer', orgName: 'Acme', matchedSkills: [{ skillName: 'Python', level: 'L3' }], remote: true, location: null });
    expect(m).toContain('ML Engineer role at Acme (remote)');
    expect(m).toContain('Python (verified L3)');
    expect(m.startsWith('Hi {name},')).toBe(true);
  });

  it('schedules follow-ups from the first send and stops after the last one', () => {
    const sent = new Date('2026-11-17T00:00:00Z');
    expect(nextFollowUpAt(sent, [3, 7], 0)?.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(nextFollowUpAt(sent, [3, 7], 1)?.toISOString()).toBe('2026-11-24T00:00:00.000Z');
    expect(nextFollowUpAt(sent, [3, 7], 2)).toBeNull();
    expect(nextFollowUpAt(sent, [], 0)).toBeNull();
  });

  it('unsubscribe tokens verify only for the same user', () => {
    const t = unsubscribeToken('user-1');
    expect(verifyUnsubscribeToken('user-1', t)).toBe(true);
    expect(verifyUnsubscribeToken('user-2', t)).toBe(false);
    expect(verifyUnsubscribeToken('user-1', 'nope')).toBe(false);
  });

  it('escapes message text for email', () => {
    expect(messageToHtml('Hi <b>\n\nLine')).toBe('<p>Hi &lt;b&gt;</p><p>Line</p>');
  });
});
