import { Injectable, NotFoundException } from '@nestjs/common';
import { CandidateRoleTitle, ClaimStatus, Prisma, ProfileViewSource, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileViewsService } from '../profile-views/profile-views.service';
import { SearchCandidatesDto } from './candidates.dto';

const LEVEL_ORDER: SkillLevel[] = [SkillLevel.L1, SkillLevel.L2, SkillLevel.L3, SkillLevel.L4];

function levelsAtOrAbove(minLevel: SkillLevel): SkillLevel[] {
  return LEVEL_ORDER.slice(LEVEL_ORDER.indexOf(minLevel));
}

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileViews: ProfileViewsService,
  ) {}

  /**
   * Privacy model: a candidate only appears at all if they have at least one
   * VERIFIED skill claim (self-claimed-only profiles are never searchable).
   * `verifiedOnly=false` widens the *match* test (skillId/minLevel can hit an
   * unverified or expired claim) without lowering that bar. Whatever is
   * actually returned per candidate is always their VERIFIED claims — those
   * are the only ones with an issued badge to link to.
   */
  async search(dto: SearchCandidatesDto) {
    const { skillId, minLevel, roleTitle, verifiedOnly, limit, offset } = dto;
    const levels = minLevel ? levelsAtOrAbove(minLevel) : undefined;

    const matchClaimWhere: Prisma.SkillClaimWhereInput = {
      ...(skillId ? { skillId } : {}),
      ...(levels ? { level: { in: levels } } : {}),
      status: skillId
        ? { in: verifiedOnly ? [ClaimStatus.VERIFIED] : Object.values(ClaimStatus) }
        : ClaimStatus.VERIFIED,
    };

    const conditions: Prisma.CandidateProfileWhereInput[] = [
      { deletedAt: null },
      { skillClaims: { some: { status: ClaimStatus.VERIFIED } } }, // privacy gate — always enforced
    ];
    if (skillId || levels) {
      conditions.push({ skillClaims: { some: matchClaimWhere } });
    }
    // Display/filter narrowing only — see CandidateRoleTitle's doc comment.
    // Never touches scoring; this whole service is a browse/search list, not
    // a job-match ranking (that's MatchingService.getMatches).
    if (roleTitle) {
      conditions.push({ roleTitle });
    }
    const where: Prisma.CandidateProfileWhereInput = { AND: conditions };

    const [total, profiles] = await Promise.all([
      this.prisma.candidateProfile.count({ where }),
      this.prisma.candidateProfile.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { updatedAt: 'desc' },
        include: {
          skillClaims: {
            where: {
              status: ClaimStatus.VERIFIED,
              ...(skillId ? { skillId } : {}),
              ...(levels ? { level: { in: levels } } : {}),
            },
            include: { skill: true, badge: true },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      candidates: profiles.map((p) => this.toCandidateSummary(p)),
    };
  }

  /**
   * GET /candidates/:id — a single-candidate view of the exact same public,
   * VERIFIED-only data search() already exposes to any org member (same
   * privacy gate: 404 unless this candidate has >=1 VERIFIED skill claim).
   * Deliberately NOT gated by EmployerCandidateAccessService.
   * employerCanViewCandidate — that check exists specifically for *private*
   * artifacts (resume/photo bytes, see JobsService.getApplicantResume /
   * ProfilesService.assertCanViewPhoto); this is a single-row version of
   * data already open to any org member via search, so it stays equally
   * open rather than introducing a stricter, inconsistent gate for the
   * same information.
   *
   * Records a ProfileView(source: DETAIL_VIEW) — see ProfileViewsService's
   * own doc comment on why this is the endpoint that does, while search()
   * and the applicant/matches list endpoints deliberately do not.
   */
  async getById(id: string, employerUserId: string) {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id, deletedAt: null, skillClaims: { some: { status: ClaimStatus.VERIFIED } } },
      include: {
        skillClaims: {
          where: { status: ClaimStatus.VERIFIED },
          include: { skill: true, badge: true },
        },
      },
    });
    if (!profile) throw new NotFoundException('Candidate not found');

    await this.profileViews.record(profile.id, employerUserId, ProfileViewSource.DETAIL_VIEW);

    return this.toCandidateSummary(profile);
  }

  private toCandidateSummary(p: {
    id: string;
    fullName: string | null;
    headline: string | null;
    roleTitle: CandidateRoleTitle | null;
    roleTitleOther: string | null;
    location: string | null;
    yearsOfExp: number | null;
    skillClaims: Prisma.SkillClaimGetPayload<{ include: { skill: true; badge: true } }>[];
  }) {
    return {
      profileId: p.id,
      fullName: p.fullName,
      headline: p.headline,
      roleTitle: p.roleTitle,
      roleTitleOther: p.roleTitleOther,
      location: p.location,
      yearsOfExp: p.yearsOfExp,
      verifiedSkills: p.skillClaims
        .filter((c) => c.badge) // only issued badges are linkable; should always be true for VERIFIED
        .map((c) => ({
          skillId: c.skillId,
          skillName: c.skill.name,
          level: c.level,
          verifiedBy: c.badge!.verifiedBy,
          verifyHash: c.badge!.verifyHash,
          // Employer-facing credibility — null for session-issued badges (see Badge.attemptNumber's doc comment).
          attemptNumber: c.badge!.attemptNumber,
        })),
    };
  }
}
