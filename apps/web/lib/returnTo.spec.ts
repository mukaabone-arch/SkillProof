import { isSafeReturnTo } from './returnTo';

describe('isSafeReturnTo', () => {
  it.each([
    ['/resume', true],
    ['/assessments/discussion/session/abc', true],
    ['/candidate', true],
  ] as const)('accepts an ordinary relative path: %s', (path, expected) => {
    expect(isSafeReturnTo(path)).toBe(expected);
  });

  it.each([
    [null, 'null'],
    ['', 'empty string'],
    ['relative/no-leading-slash', 'no leading slash'],
    ['//evil.com', 'protocol-relative URL'],
    ['///evil.com', 'triple-slash variant'],
    ['https://evil.com', 'absolute URL'],
    ['https://evil.com/resume', 'absolute URL with a path'],
    ['/\\evil.com', 'backslash, which some browsers normalize to a slash'],
    ['/\\/evil.com', 'backslash-slash variant'],
  ] as const)('rejects %s (%s)', (path, _reason) => {
    expect(isSafeReturnTo(path)).toBe(false);
  });
});
