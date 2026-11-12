import { clientCountry } from './clientCountry';

function withEnv(timeZone: string, language: string, fn: () => void) {
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () => ({ resolvedOptions: () => ({ timeZone }) }) as unknown as Intl.DateTimeFormat,
  );
  const lang = jest.spyOn(navigator, 'language', 'get').mockReturnValue(language);
  try {
    fn();
  } finally {
    spy.mockRestore();
    lang.mockRestore();
  }
}

describe('clientCountry', () => {
  it('treats an Indian time zone as India, whatever the browser language', () => {
    withEnv('Asia/Kolkata', 'en-US', () => expect(clientCountry()).toBe('IN'));
    withEnv('Asia/Calcutta', 'en', () => expect(clientCountry()).toBe('IN'));
  });

  it("uses the language's region elsewhere, or ZZ when there isn't one", () => {
    withEnv('Asia/Dubai', 'en-AE', () => expect(clientCountry()).toBe('AE'));
    withEnv('Europe/London', 'en-GB', () => expect(clientCountry()).toBe('GB'));
    withEnv('America/New_York', 'en', () => expect(clientCountry()).toBe('ZZ'));
  });
});
