import { isLocalizedPath } from './routing';

describe('isLocalizedPath', () => {
  const paths = ['/', '/employer/dashboard', '/employer/candidates/[id]/portfolio', '/badges/[hash]'];

  it('matches literal entries exactly, ignoring a trailing slash', () => {
    expect(isLocalizedPath('/', paths)).toBe(true);
    expect(isLocalizedPath('/employer/dashboard', paths)).toBe(true);
    expect(isLocalizedPath('/employer/dashboard/', paths)).toBe(true);
    expect(isLocalizedPath('/employer/dashboard/extra', paths)).toBe(false);
  });

  it('matches a [param] segment against any single real segment', () => {
    expect(isLocalizedPath('/employer/candidates/abc123/portfolio', paths)).toBe(true);
    expect(isLocalizedPath('/badges/9f8e7d6c', paths)).toBe(true);
  });

  it('does not let a [param] segment span several segments', () => {
    expect(isLocalizedPath('/employer/candidates/a/b/portfolio', paths)).toBe(false);
    expect(isLocalizedPath('/badges/9f8e/extra', paths)).toBe(false);
  });

  it('treats regex metacharacters in a literal entry as literal text', () => {
    expect(isLocalizedPath('/employer/dashboardX', ['/employer/dashboard.'])).toBe(false);
  });

  it('is false for every path when nothing is localised', () => {
    expect(isLocalizedPath('/', [])).toBe(false);
  });
});
