import { hasVisiblePortfolio } from './portfolio.util';

describe('hasVisiblePortfolio', () => {
  it('is false for no portfolio row at all', () => {
    expect(hasVisiblePortfolio(null)).toBe(false);
    expect(hasVisiblePortfolio(undefined)).toBe(false);
  });

  it('is false when approvedAt is null, even if visibleToEmployers is true', () => {
    expect(hasVisiblePortfolio({ approvedAt: null, visibleToEmployers: true })).toBe(false);
  });

  it('is false when visibleToEmployers is false, even if approvedAt is set', () => {
    expect(hasVisiblePortfolio({ approvedAt: new Date(), visibleToEmployers: false })).toBe(false);
  });

  it('is true only when both approvedAt is set and visibleToEmployers is true', () => {
    expect(hasVisiblePortfolio({ approvedAt: new Date(), visibleToEmployers: true })).toBe(true);
  });
});
