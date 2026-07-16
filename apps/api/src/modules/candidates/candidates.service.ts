import { Injectable } from '@nestjs/common';
import { ClaimStatus, Prisma, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchCandidatesDto } from './candidates.dto';

const LEVEL_ORDER: SkillLevel[] = [SkillLevel.L1, SkillLevel.L2, SkillLevel.L3, SkillLevel.L4];

function levelsAtOrAbove(minLevel: SkillLevel): SkillLevel[] {
  return LEVEL_ORDER.slice(LEVEL_ORDER.indexOf(minLevel));
}

@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService) {}

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
      candidates: profiles.map((p) => ({
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
          })),
      })),
    };
  }
}
