import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The one condition every employer-facing candidate query must include —
 * search (CandidatesService.search), matching (MatchingService.getMatches),
 * and the match-digest email job (MatchDigestService.sendDigests) — so a
 * deactivated or deleted candidate can never appear in a new place. Two
 * separate booleans, not one: deactivatedAt is reversible and deletedAt is
 * not (see CandidateProfile.deactivatedAt's own doc comment), but from a
 * caller's point of view "should this candidate be visible right now" is
 * the same question either way, so this is the single place that answers
 * it — every call site spreads this into its own `where`, rather than each
 * one re-deriving "deletedAt: null, deactivatedAt: null" independently and
 * risking one of them drifting to check only one of the two fields.
 */
export const candidateVisibilityFilter: Prisma.CandidateProfileWhereInput = {
  deletedAt: null,
  deactivatedAt: null,
};

/**
 * "Can't be newly shortlisted or invited" — the one gate candidateVisibilityFilter
 * alone doesn't cover, since that's a passive read-time filter and this is
 * a write-time rejection. Shared by ShortlistService.add (SHORTLISTED) and
 * ShortlistPipelineService.invite (SHORTLISTED -> INVITED) — a candidate
 * can be shortlisted, then deactivate, then an employer might still try to
 * invite them days later, so both entry points need this, not just one.
 */
export async function assertCandidateAvailableForPipeline(prisma: PrismaService, candidateId: string): Promise<void> {
  const visible = await prisma.candidateProfile.findFirst({
    where: { id: candidateId, ...candidateVisibilityFilter },
    select: { id: true },
  });
  if (!visible) {
    throw new BadRequestException('This candidate is not available right now.');
  }
}
