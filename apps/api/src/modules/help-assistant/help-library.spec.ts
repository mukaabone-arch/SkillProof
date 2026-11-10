import { HelpLibraryEntry, HelpLibraryMatcher, looksPersonal, normalizeQuestion, tokens } from './help-library';

export const FIXTURE: HelpLibraryEntry[] = [
  {
    id: 'retake',
    question: 'Can I retake an assessment?',
    variants: ['failed my test what now', 'how many retakes do I get', 'retry a skill check', 'can i do the test again'],
    answer: 'Yes. You can retake...',
    sectionIds: ['retakes'],
  },
  {
    id: 'badge',
    question: 'How do I get my first verified badge?',
    variants: ['how to earn a badge', 'get verified skill badge', 'first badge steps'],
    answer: 'Open Assessments...',
    sectionIds: ['assessments'],
  },
  {
    id: 'jobs',
    question: 'How do I find jobs?',
    variants: ['find jobs for me', 'where are jobs', 'search for jobs', 'find matching roles'],
    answer: 'Go to the Jobs page...',
    sectionIds: ['jobs'],
  },
  {
    id: 'recruiters',
    question: 'How do I turn on recruiter visibility?',
    variants: ['show my profile to staffing agencies', 'enable recruiter access', 'opt in to recruiters'],
    answer: 'Turn on Available to recruiters...',
    sectionIds: ['recruiters-opt-in'],
  },
  {
    id: 'delete',
    question: 'How do I delete my account?',
    variants: ['remove my account', 'close my account permanently', 'delete profile'],
    answer: 'Go to Profile, then Account...',
    sectionIds: ['delete'],
  },
  {
    id: 'deactivate',
    question: 'How do I deactivate my account?',
    variants: ['pause my account', 'hide my profile for a while', 'temporarily disable account'],
    answer: 'Deactivating hides you...',
    sectionIds: ['deactivate'],
  },
];

describe('tokens / normalizeQuestion', () => {
  it('drops filler words and punctuation and lightly stems', () => {
    expect(tokens('How do I retake my Tests?')).toEqual(['retake', 'test']);
    expect(normalizeQuestion('  Can I RETAKE   an assessment??  ')).toBe(normalizeQuestion('can i retake an assessment'));
  });

  it('keeps non-Latin words', () => {
    expect(tokens('كيف أحصل على شارة')).toContain('شارة');
  });
});

describe('HelpLibraryMatcher', () => {
  const m = new HelpLibraryMatcher(FIXTURE);

  it.each([
    ['Can I retake an assessment?', 'retake'],
    ['failed my test, what now?', 'retake'],
    ['How many retakes do I get', 'retake'],
    ['how do i get my first verified badge', 'badge'],
    ['remove my account', 'delete'],
    ['pause my account', 'deactivate'],
    ['how can I find jobs', 'jobs'],
  ])('matches "%s" to %s', (q, id) => {
    expect(m.match(q)?.entry.id).toBe(id);
  });

  it.each([
    'What salary should I ask for?',
    'how do I write a cover letter for google',
    'account',
    'hi',
    '',
    'كيف أحصل على شارة موثقة؟',
    // Found in the first real eval: matched the jobs entry on "find", even
    // with a recruiter entry in the library.
    'How do I let recruiters find me?',
  ])('sends "%s" live', (q) => {
    expect(m.match(q)).toBeNull();
  });

  it('does not guess between two close entries', () => {
    // "my account" alone sits between delete and deactivate.
    expect(m.match('my account settings')).toBeNull();
  });
});

describe('looksPersonal', () => {
  it('flags numbers and emails', () => {
    expect(looksPersonal('my number is 9876543210')).toBe(true);
    expect(looksPersonal('change a@b.com')).toBe(true);
    expect(looksPersonal('Can I retake an L2 test?')).toBe(false);
  });
});
