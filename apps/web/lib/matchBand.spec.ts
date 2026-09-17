import { matchBand } from './matchBand';

describe('matchBand', () => {
  it.each([
    [0, 'none'],
    [24, 'none'],
    [25, 'partial'],
    [49, 'partial'],
    [50, 'good'],
    [74, 'good'],
    [75, 'strong'],
    [100, 'strong'],
  ] as const)('matchBand(%i) === %s', (score, expected) => {
    expect(matchBand(score)).toBe(expected);
  });
});
