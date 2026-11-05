import { localeAlternates, localizedUrl } from './localeMetadata';
import { formatBetaPromoDate, BETA_FREE_UNTIL } from './betaPromo';

describe('localeAlternates', () => {
  it('builds self-canonical + hreflang en/ar/x-default for the landing page', () => {
    expect(localeAlternates('en', '/')).toEqual({
      canonical: 'https://www.myambii.com/',
      languages: { en: 'https://www.myambii.com/', ar: 'https://www.myambii.com/ar', 'x-default': 'https://www.myambii.com/' },
    });
    const ar = localeAlternates('ar', '/');
    expect(ar.canonical).toBe('https://www.myambii.com/ar');
    expect(ar.languages).toEqual(localeAlternates('en', '/').languages);
  });

  it('prefixes non-root paths for Arabic only', () => {
    expect(localizedUrl('en', '/faq')).toBe('https://www.myambii.com/faq');
    expect(localizedUrl('ar', '/faq')).toBe('https://www.myambii.com/ar/faq');
  });
});

describe('formatBetaPromoDate', () => {
  it('keeps the English wording', () => {
    expect(formatBetaPromoDate(BETA_FREE_UNTIL, 'en')).toBe('31 January 2027');
  });

  it('renders the Arabic month with Western digits and the Gregorian calendar', () => {
    const s = formatBetaPromoDate(BETA_FREE_UNTIL, 'ar');
    expect(s).toBe('31 يناير 2027');
    expect(s).not.toMatch(/[٠-٩]/);
  });
});
