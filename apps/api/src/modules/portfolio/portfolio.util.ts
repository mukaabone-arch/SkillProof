import { CandidatePortfolio } from '@prisma/client';

/**
 * The one "does this candidate have a portfolio an employer can open" check
 * — PortfolioService.getForEmployer's own 404 gate, and every list that
 * decides whether to render a "View portfolio" link before the employer
 * ever requests that page (JobsService.applicantsFor, ShortlistService.list)
 * must reuse this rather than re-deriving `approvedAt && visibleToEmployers`
 * independently. Re-deriving it is exactly how the link and the page it
 * points to drifted apart before: ApplicantCard rendered "View portfolio"
 * unconditionally, so a candidate with no approved/visible portfolio sent
 * the employer to a raw 404.
 */
export function hasVisiblePortfolio<T extends Pick<CandidatePortfolio, 'approvedAt' | 'visibleToEmployers'>>(
  portfolio: T | null | undefined,
): portfolio is T {
  return !!portfolio && portfolio.approvedAt != null && portfolio.visibleToEmployers === true;
}
