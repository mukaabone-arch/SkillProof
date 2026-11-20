import { Injectable, NotFoundException } from '@nestjs/common';
import { CertVerificationStatus, ClaimStatus, OrgType, OutreachStatus, StaffingRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { candidateRef } from '../staffing/staffing.util';

const LEVEL_NAME: Record<string, string> = { L1: 'Foundational', L2: 'Practitioner', L3: 'Advanced', L4: 'Expert' };

export interface CandidatePackage {
  id: string;
  ref: string;
  name: string | null;
  headline: string | null;
  roleTitle: string | null;
  location: string | null;
  openToRemote: boolean;
  yearsOfExperience: number | null;
  aiYearsOfExperience: number | null;
  /** Only when this org may see contact details (see contactAllowed). */
  contact: { email: string | null; phone: string | null } | null;
  verifiedSkills: { skill: string; level: string; levelName: string; verifiedBy: string; issuedAt: string; expiresAt: string; verifyUrl: string }[];
  certifications: { name: string; issuer: string; issueDate: string; expiryDate: string | null; credentialUrl: string | null }[];
  /** API path for the resume PDF (needs an API key); null unless the candidate applied to this org. */
  resumeApiPath: string | null;
}

/**
 * The "candidate package" an ATS needs: who the candidate is, their
 * verified skills with links anyone can check, verified certifications,
 * and, only where MyAmbii's existing rules allow it, contact details and
 * the resume. Used by webhooks, the API and the JSON download, so all
 * three always show the same thing.
 *
 * Contact details follow the rules elsewhere in the product: an org sees
 * them when the candidate applied to its job or said Interested to its AI
 * sourcing message; a recruiter also when the candidate approved a
 * submission or said yes to an availability check. Recruiters see no name
 * until then either (their search is anonymised). The resume stays behind
 * the narrower "applied to this org" rule (EmployerCandidateAccessService).
 */
@Injectable()
export class CandidatePackageService {
  constructor(private readonly prisma: PrismaService) {}

  async build(orgId: string, candidateId: string): Promise<CandidatePackage> {
    const [org, profile] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { type: true } }),
      this.prisma.candidateProfile.findUnique({
        where: { id: candidateId },
        include: {
          user: { select: { email: true, phone: true } },
          skillClaims: { where: { status: ClaimStatus.VERIFIED }, include: { skill: { select: { name: true } }, badge: true } },
          certifications: {
            where: { verificationStatus: CertVerificationStatus.VERIFIED },
            select: { name: true, issuer: true, issuerOther: true, issueDate: true, expiryDate: true, credentialUrl: true },
          },
        },
      }),
    ]);
    if (!profile || profile.deletedAt) throw new NotFoundException('Candidate not found');

    const staffing = org?.type === OrgType.STAFFING;
    const { contact, applied } = await this.relationship(orgId, candidateId, staffing);
    const showName = !staffing || contact;

    return {
      id: profile.id,
      ref: candidateRef(profile.id),
      name: showName ? profile.fullName : null,
      headline: showName ? profile.headline : null,
      roleTitle: profile.roleTitleOther || profile.roleTitle,
      location: [profile.locationCity, profile.locationRegion, profile.locationCountry].filter(Boolean).join(', ') || (showName ? profile.locationLegacy : null),
      openToRemote: profile.openToRemote,
      yearsOfExperience: profile.yearsOfExp,
      aiYearsOfExperience: profile.aiYearsOfExp,
      contact: contact ? { email: profile.user.email, phone: profile.user.phone } : null,
      verifiedSkills: profile.skillClaims
        .filter((c) => c.badge && !c.badge.revokedAt)
        .map((c) => ({
          skill: c.skill.name,
          level: c.level,
          levelName: LEVEL_NAME[c.level] ?? c.level,
          verifiedBy: c.badge!.verifiedBy,
          issuedAt: c.badge!.issuedAt.toISOString(),
          expiresAt: c.badge!.expiresAt.toISOString(),
          verifyUrl: `${WEB_BASE_URL}/badges/${c.badge!.verifyHash}`,
        })),
      certifications: profile.certifications.map((c) => ({
        name: c.name,
        issuer: c.issuerOther || c.issuer,
        issueDate: c.issueDate.toISOString(),
        expiryDate: c.expiryDate?.toISOString() ?? null,
        credentialUrl: c.credentialUrl,
      })),
      resumeApiPath: applied && profile.resumeS3Key ? `/v1/candidates/${profile.id}/resume` : null,
    };
  }

  /** Whether this org may see contact details, and whether the candidate applied to it (the resume rule). */
  async relationship(orgId: string, candidateId: string, staffing: boolean): Promise<{ contact: boolean; applied: boolean; known: boolean }> {
    const [application, interested, consented, available, inPipeline] = await Promise.all([
      this.prisma.application.findFirst({ where: { candidateProfileId: candidateId, job: { orgId } }, select: { id: true } }),
      this.prisma.outreachMessage.findFirst({ where: { orgId, candidateId, status: OutreachStatus.INTERESTED }, select: { id: true } }),
      staffing
        ? this.prisma.staffingSubmission.findFirst({ where: { orgId, candidateId, consentedAt: { not: null } }, select: { id: true } })
        : null,
      staffing
        ? this.prisma.staffingAvailabilityRequest.findFirst({
            where: { orgId, candidateId, status: { in: [StaffingRequestStatus.AVAILABLE, StaffingRequestStatus.CONDITIONAL] } },
            select: { id: true },
          })
        : null,
      staffing
        ? this.prisma.staffingSubmission.findFirst({ where: { orgId, candidateId }, select: { id: true } })
        : this.prisma.shortlistEntry.findFirst({ where: { orgId, candidateId }, select: { id: true } }),
    ]);
    const contact = !!(application || interested || consented || available);
    return { contact, applied: !!application, known: contact || !!inPipeline };
  }
}
