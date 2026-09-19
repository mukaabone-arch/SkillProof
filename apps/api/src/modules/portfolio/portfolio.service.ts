import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CertVerificationStatus, ClaimStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { EmployerCandidateAccessService } from '../access/employer-candidate-access.service';
import { candidateVisibilityFilter } from '../account/account.util';
import { formatLocation } from '../locations/location-format.util';
import { UpdatePortfolioContentDto } from './portfolio.dto';

const skillClaimsInclude = { skillClaims: { where: { status: ClaimStatus.VERIFIED }, include: { skill: true, badge: true } } } as const;
const certificationsWhere: Prisma.CertificationWhereInput = {
  verificationStatus: CertVerificationStatus.VERIFIED,
  OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
};

type ProfileWithVerifiedData = Prisma.CandidateProfileGetPayload<{
  include: typeof skillClaimsInclude;
}> & { certifications: Prisma.CertificationGetPayload<Record<string, never>>[] };

/**
 * Every verified-skill-claim badge for a profile, in the exact shape
 * candidates.service.ts's toCandidateSummary already returns them — same
 * fields, same "only issued badges are linkable" filter — so this page's
 * verified section reads identically to the rest of the app rather than
 * inventing a second shape for the same data.
 */
function buildVerifiedBadges(profile: ProfileWithVerifiedData) {
  return profile.skillClaims
    .filter((c) => c.badge)
    .map((c) => ({
      skillId: c.skillId,
      skillName: c.skill.name,
      level: c.level,
      verifiedBy: c.badge!.verifiedBy,
      verifyHash: c.badge!.verifyHash,
      issuedAt: c.badge!.issuedAt,
      expiresAt: c.badge!.expiresAt,
    }));
}

/** VERIFIED, non-expired certifications only — see this model's doc comment in schema.prisma. Held to the same "verified" bar as a skill badge. */
function buildVerifiedCertifications(profile: ProfileWithVerifiedData) {
  return profile.certifications.map((c) => ({
    id: c.id,
    name: c.name,
    issuer: c.issuer,
    issuerOther: c.issuerOther,
    issueDate: c.issueDate,
    expiryDate: c.expiryDate,
    credentialUrl: c.credentialUrl,
  }));
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly employerAccess: EmployerCandidateAccessService,
  ) {}

  /**
   * Called once, right after a resume upload (ProfilesController) — never
   * from a portfolio read path. A parse failure (e.g. the LLM is down) is
   * swallowed here rather than failing the upload itself: the resume file
   * is already safely stored by the time this runs, and re-uploading (or a
   * future retry) is the recovery path, not blocking on Claude availability
   * for what's still just a resume upload.
   */
  async parseFromResume(userId: string, pdfBuffer: Buffer, resumeKey: string): Promise<void> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) return;

    let extraction;
    try {
      extraction = await this.llm.extractPortfolio(pdfBuffer.toString('base64'));
    } catch (err) {
      this.logger.error(`Portfolio parse failed for profile ${profile.id}: ${(err as Error).message}`);
      return;
    }

    // Re-parse always resets approvedAt to null — a new draft has not been
    // reviewed yet, however similar it looks to the last one. visibleToEmployers
    // is left untouched: that's the candidate's standing publish preference,
    // not something a re-upload should silently revoke.
    await this.prisma.candidatePortfolio.upsert({
      where: { profileId: profile.id },
      create: {
        profileId: profile.id,
        content: extraction as unknown as Prisma.InputJsonValue,
        sourceResumeKey: resumeKey,
      },
      update: {
        content: extraction as unknown as Prisma.InputJsonValue,
        sourceResumeKey: resumeKey,
        approvedAt: null,
        parsedAt: new Date(),
      },
    });
  }

  async getMine(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      include: { ...skillClaimsInclude, certifications: { where: certificationsWhere }, portfolio: true },
    });
    if (!profile) throw new NotFoundException('Candidate profile not found.');

    return {
      hasResume: !!profile.resumeS3Key,
      fullName: profile.fullName,
      headline: profile.headline,
      location: formatLocation(profile),
      yearsOfExp: profile.yearsOfExp,
      githubUrl: profile.githubUrl,
      linkedinUrl: profile.linkedinUrl,
      content: profile.portfolio?.content ?? null,
      approvedAt: profile.portfolio?.approvedAt ?? null,
      visibleToEmployers: profile.portfolio?.visibleToEmployers ?? false,
      parsedAt: profile.portfolio?.parsedAt ?? null,
      verifiedBadges: buildVerifiedBadges(profile),
      verifiedCertifications: buildVerifiedCertifications(profile),
    };
  }

  /** Any content edit un-approves the portfolio — the candidate must re-review before it can go visible again, same as a fresh parse. */
  async updateContent(userId: string, dto: UpdatePortfolioContentDto) {
    const portfolio = await this.getOwnPortfolioOrThrow(userId);
    await this.prisma.candidatePortfolio.update({
      where: { id: portfolio.id },
      data: { content: dto as unknown as Prisma.InputJsonValue, approvedAt: null },
    });
    return this.getMine(userId);
  }

  async approve(userId: string) {
    const portfolio = await this.getOwnPortfolioOrThrow(userId);
    await this.prisma.candidatePortfolio.update({ where: { id: portfolio.id }, data: { approvedAt: new Date() } });
    return this.getMine(userId);
  }

  async setVisibility(userId: string, visible: boolean) {
    const portfolio = await this.getOwnPortfolioOrThrow(userId);
    await this.prisma.candidatePortfolio.update({ where: { id: portfolio.id }, data: { visibleToEmployers: visible } });
    return this.getMine(userId);
  }

  /**
   * GET /portfolio/candidates/:id for an employer. Order matters, same
   * reasoning as JobsService.getApplicantResume: the relationship check
   * (403) runs before existence/publish-state (404), so an org with no
   * relationship to this candidate never learns whether they even have a
   * portfolio. Uses the broader employerCanViewPortfolio (Application OR
   * ShortlistEntry OR AssessmentRequest) — see that method's doc comment
   * for why this is intentionally wider than the resume/photo check.
   */
  async getForEmployer(orgId: string, candidateId: string) {
    const allowed = await this.employerAccess.employerCanViewPortfolio(orgId, candidateId);
    if (!allowed) throw new ForbiddenException();

    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id: candidateId, ...candidateVisibilityFilter },
      include: {
        ...skillClaimsInclude,
        certifications: { where: certificationsWhere },
        portfolio: true,
        user: { select: { email: true, phone: true } },
      },
    });
    if (!profile || !profile.portfolio || !profile.portfolio.approvedAt || !profile.portfolio.visibleToEmployers) {
      throw new NotFoundException();
    }

    // Contact details are held to the same, narrower bar as resume/photo —
    // see EmployerCandidateAccessService.employerCanViewCandidate's doc
    // comment. A relationship broad enough to open the portfolio (e.g.
    // shortlist-only, no application) is not automatically broad enough to
    // see an email/phone number.
    const contactAllowed = await this.employerAccess.employerCanViewCandidate(orgId, candidateId);

    return {
      fullName: profile.fullName,
      headline: profile.headline,
      location: formatLocation(profile),
      yearsOfExp: profile.yearsOfExp,
      // Already ungated on every other employer-facing candidate view (see
      // ApplicantCard.tsx) — not a private artifact like email/phone.
      githubUrl: profile.githubUrl,
      linkedinUrl: profile.linkedinUrl,
      content: profile.portfolio.content,
      verifiedBadges: buildVerifiedBadges(profile),
      verifiedCertifications: buildVerifiedCertifications(profile),
      contact: contactAllowed ? { email: profile.user.email, phone: profile.user.phone } : null,
    };
  }

  private async getOwnPortfolioOrThrow(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('Candidate profile not found.');

    const portfolio = await this.prisma.candidatePortfolio.findUnique({ where: { profileId: profile.id } });
    if (!portfolio) {
      throw new NotFoundException('Upload a resume first — your portfolio is built from it.');
    }
    return portfolio;
  }
}
