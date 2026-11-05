/**
 * Arabic number-noun agreement and digits in the messages that take a count.
 * Arabic has six plural categories (zero, one, two, few, many, other); a
 * string like "{days} يوم" cannot inflect, so these use ICU plural syntax.
 * Numbers render with Western digits via the `latn` named format
 * (lib/formatLocale.ts MESSAGE_FORMATS).
 */
import { createTranslator } from 'next-intl';
import ar from '../messages/ar.json';
import { MESSAGE_FORMATS } from './formatLocale';

const t = createTranslator({ locale: 'ar', messages: ar, formats: MESSAGE_FORMATS });

describe('Arabic plurals', () => {
  it.each([
    [0, '0 يوم'],
    [1, 'يوم واحد'],
    [2, 'يومان'],
    [3, '3 أيام'],
    [10, '10 أيام'],
    [11, '11 يومًا'],
    [99, '99 يومًا'],
    [100, '100 يوم'],
  ])('avgDays %i → %s', (days, expected) => {
    expect(t('employerDashboard.avgDays', { days })).toBe(expected);
  });

  it.each([
    [1, 'سنة واحدة'],
    [2, 'سنتان'],
    [5, '5 سنوات'],
    [12, '12 سنة'],
  ])('experienceYears %i → %s …', (years, expected) => {
    expect(t('employerMatches.experienceYears', { years })).toBe(`${expected} (حسب تصريح المتقدم)`);
  });

  it('never renders Arabic-Indic digits in a counted message', () => {
    const out = [
      t('employerDashboard.avgDays', { days: 12 }),
      t('employerDashboard.jobMeta', { count: 15, date: '1 يناير' }),
      t('employerDashboard.pipelineSummary', { total: 40, declined: 3, rejected: 4, closed: 5 }),
      t('employerMatches.experienceYears', { years: 7 }),
    ].join(' ');
    expect(out).not.toMatch(/[٠-٩]/);
    expect(out).toMatch(/12/);
  });

  it('pins Western digits even where the locale defaults to Arabic-Indic', () => {
    // ar-SA defaults to ٠-٩ in ICU; browsers differ on plain `ar`. The named
    // `latn` format must win either way — and without it, it would not.
    const pinned = createTranslator({ locale: 'ar-SA', messages: ar, formats: MESSAGE_FORMATS });
    expect(pinned('employerDashboard.avgDays', { days: 12 })).toBe('12 يومًا');
    // Control: an unnamed number format follows the locale's default digits.
    const unpinned = createTranslator({ locale: 'ar-SA', messages: { x: '{n, number}' } });
    expect(unpinned('x', { n: 12 })).toBe('١٢');
  });
});
