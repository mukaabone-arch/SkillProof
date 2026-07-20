import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The single "legitimate employer↔candidate relationship" check, reused by
 * every employer-facing view of a candidate's private artifacts — resume,
 * photo, and (per the original Phase 2 seam this generalizes) full profile
 * detail. True iff the candidate has applied to at least one job owned by
 * orgId.
 *
 * Being on the org's shortlist (ShortlistEntry) does NOT satisfy this check
 * on its own — a shortlist entry can be created from the org-wide candidate
 * search for someone who has never applied to anything (see
 * ShortlistService.add's jobId-less path), which is a distinct, narrower
 * relationship than "has applied." Only Application counts here.
 */
@Injectable()
export class EmployerCandidateAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async employerCanViewCandidate(orgId: string, candidateId: string): Promise<boolean> {
    const application = await this.prisma.application.findFirst({
      where: { candidateProfileId: candidateId, job: { orgId } },
      select: { id: true },
    });
    return application !== null;
  }
}
