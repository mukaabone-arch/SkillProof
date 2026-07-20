import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CandidateProfile, ClaimStatus, Prisma, Role } from '@prisma/client';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { EmployerCandidateAccessService } from '../access/employer-candidate-access.service';
import { GenerateResumeDto, UpdateProfileDto } from './profiles.dto';
import { buildResumePdf, VerifiedSkillEntry } from './resume-pdf.builder';
import { UPLOAD_DIR } from '../../config/upload-dir';

/** JwtAuthGuard's decoded token shape — just enough to decide viewer authorization. */
interface Requester {
  sub: string;
  role: string;
}

type CompletenessFields = Pick<
  CandidateProfile,
  'fullName' | 'headline' | 'location' | 'yearsOfExp' | 'githubUrl' | 'linkedinUrl'
> & { email: string | null };

/** Extension -> Content-Type for reading a stored photo back. Keyed off
 * the extension ProfilesController.uploadPhoto's fileFilter already wrote
 * (see PHOTO_EXTENSION_BY_MIME there), so every value here is reachable. */
const PHOTO_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Strips the raw storage key off a CandidateProfile row before it ever
 * reaches a client, replacing it with a boolean — clients fetch the actual
 * bytes only through the authenticated GET /profiles/:id/photo proxy,
 * never by learning the key itself. Used by every response shape that
 * spreads a raw profile row (getMe, updateMe). */
function withHasPhoto<T extends { photoKey: string | null }>(profile: T): Omit<T, 'photoKey'> & { hasPhoto: boolean } {
  const { photoKey, ...rest } = profile;
  return { ...rest, hasPhoto: photoKey != null };
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly employerAccess: EmployerCandidateAccessService,
  ) {}

  async getMe(userId: string) {
    const [profile, email] = await Promise.all([this.ensureProfile(userId), this.getEmail(userId)]);
    return { ...withHasPhoto(profile), email };
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const { email, ...profileFields } = dto;
    const existing = await this.ensureProfile(userId);

    const currentEmail = email !== undefined ? await this.updateEmail(userId, email) : await this.getEmail(userId);
    const merged: CompletenessFields = { ...existing, ...profileFields, email: currentEmail };

    const updated = await this.prisma.candidateProfile.update({
      where: { userId },
      data: { ...profileFields, completeness: this.computeCompleteness(merged) },
    });
    return { ...withHasPhoto(updated), email: currentEmail };
  }

  private async getEmail(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    return user.email;
  }

  /** Surfaces a clear 409 instead of a 500 when the email is already claimed by another account. */
  private async updateEmail(userId: string, email: string): Promise<string | null> {
    try {
      const user = await this.prisma.user.update({ where: { id: userId }, data: { email } });
      return user.email;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This email address is already in use by another account.');
      }
      throw err;
    }
  }

  /**
   * Records the uploaded PDF's filename within UPLOAD_DIR. Reuses
   * CandidateProfile.resumeS3Key (named for the original S3 design — still
   * local disk for now, see UPLOAD_DIR's own doc comment on why).
   */
  async saveResume(userId: string, filename: string) {
    await this.ensureProfile(userId);
    return this.prisma.candidateProfile.update({
      where: { userId },
      data: { resumeS3Key: filename },
    });
  }

  /**
   * Parses the candidate's already-uploaded resume with Claude and returns the
   * extracted fields for review — nothing is written to the profile here.
   */
  async parseResume(userId: string) {
    const pdfBuffer = await this.readStoredResume(userId);
    return this.llm.extractResumeFields(pdfBuffer.toString('base64'));
  }

  /**
   * Rewrites the candidate's already-uploaded resume into a stronger,
   * structured version (summary/experience/education/skills) for review —
   * nothing is written to the profile here, exactly like parseResume. Reads
   * the source PDF fresh rather than working from parseResume's sparse
   * output; see LlmService.improveResume for why.
   */
  async improveResume(userId: string) {
    const pdfBuffer = await this.readStoredResume(userId);
    return this.llm.improveResume(pdfBuffer.toString('base64'));
  }

  /**
   * Renders a one-page PDF from the candidate's profile + verified badges,
   * plus whatever improved/edited content the client sends (both empty for
   * "build from profile" and populated for "improve my resume" hit this same
   * method). Never persisted — this is a one-off download.
   */
  async generateResumePdf(userId: string, dto: GenerateResumeDto): Promise<Buffer> {
    const profile = await this.ensureProfile(userId);
    const verifiedSkills = await this.getVerifiedSkillsForResume(profile.id);

    return buildResumePdf({
      fullName: profile.fullName || 'SkillProof Candidate',
      headline: profile.headline,
      location: profile.location,
      yearsOfExp: profile.yearsOfExp,
      githubUrl: profile.githubUrl,
      linkedinUrl: profile.linkedinUrl,
      summary: dto.summary,
      experience: dto.experience,
      education: dto.education,
      skills: dto.skills,
      verifiedSkills,
    });
  }

  /** Only currently-valid badges — an admin-INVALIDATED (revoked) one must never appear as verified. */
  private async getVerifiedSkillsForResume(profileId: string): Promise<VerifiedSkillEntry[]> {
    const claims = await this.prisma.skillClaim.findMany({
      where: { profileId, status: ClaimStatus.VERIFIED, badge: { revokedAt: null } },
      include: { skill: true, badge: true },
    });

    const verifyBaseUrl = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',')[0];
    return claims
      .filter((c) => c.badge)
      .map((c) => ({
        skillName: c.skill.name,
        level: c.level,
        verifiedBy: c.badge!.verifiedBy,
        verifyUrl: `${verifyBaseUrl}/badges/${c.badge!.verifyHash}`,
      }));
  }

  private async readStoredResume(userId: string): Promise<Buffer> {
    const profile = await this.ensureProfile(userId);
    if (!profile.resumeS3Key) {
      throw new BadRequestException('Upload a resume before parsing it.');
    }
    return this.readResumeFileFromDisk(profile.resumeS3Key);
  }

  /**
   * Employer-facing resume read for GET /jobs/:jobId/applicants/:candidateId/resume.
   * The caller (JobsService) has already run EmployerCandidateAccessService's
   * employerCanViewCandidate check before reaching here — this method only
   * answers "does this candidate have a resume on disk," not who's allowed
   * to ask. 404 (not 400, unlike the owner path above) when there's no
   * resume — an employer browsing applicants isn't "missing a step," the
   * candidate just hasn't uploaded one.
   */
  async getResumeForCandidate(profileId: string): Promise<{ buffer: Buffer; filename: string }> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { id: profileId } });
    if (!profile?.resumeS3Key) {
      throw new NotFoundException('This candidate has not uploaded a resume.');
    }
    const buffer = await this.readResumeFileFromDisk(profile.resumeS3Key);
    // Candidate-controlled fullName, sanitized before it ever reaches a
    // Content-Disposition header — strip everything but word chars/spaces/
    // dashes so it can't break out of the quoted filename.
    const safeName = (profile.fullName ?? '').replace(/[^\w \-]+/g, '').trim();
    return { buffer, filename: `${safeName || 'resume'}.pdf` };
  }

  /** The only place any resume-serving path touches UPLOAD_DIR — shared by the owner (parse/improve) and employer (getResumeForCandidate) reads. */
  private async readResumeFileFromDisk(resumeS3Key: string): Promise<Buffer> {
    try {
      return await fs.readFile(join(UPLOAD_DIR, resumeS3Key));
    } catch {
      throw new NotFoundException('Stored resume file could not be read. Try re-uploading.');
    }
  }

  /**
   * Records the uploaded image's filename within UPLOAD_DIR, same storage
   * as resumes (see saveResume). Unlike saveResume, this deletes the
   * previous file first — a photo is expected to be replaced repeatedly
   * over a candidate's account lifetime, and letting old ones accumulate
   * unreferenced on disk was explicitly called out as something to avoid
   * for this feature (resumes don't have this cleanup; that's an existing
   * gap out of scope here, not one to introduce for photos too).
   */
  async savePhoto(userId: string, filename: string) {
    const profile = await this.ensureProfile(userId);
    if (profile.photoKey) {
      await this.deleteStoredFile(profile.photoKey);
    }
    const updated = await this.prisma.candidateProfile.update({
      where: { userId },
      data: { photoKey: filename },
    });
    return withHasPhoto(updated);
  }

  async deletePhoto(userId: string) {
    const profile = await this.ensureProfile(userId);
    if (profile.photoKey) {
      await this.deleteStoredFile(profile.photoKey);
    }
    const updated = await this.prisma.candidateProfile.update({
      where: { userId },
      data: { photoKey: null },
    });
    return withHasPhoto(updated);
  }

  /**
   * Reads a candidate's photo bytes for GET /profiles/:id/photo. `id` is
   * CandidateProfile.id (the same id employer-facing views already key
   * candidates by — CandidateSearch/EmployerShortlist/EmployerJobs all use
   * profileId/candidateId — so this endpoint can be reached the same way
   * once Phase 2 opens it up to employers).
   */
  async getPhotoForViewing(profileId: string, requester: Requester): Promise<{ buffer: Buffer; contentType: string }> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException();

    await this.assertCanViewPhoto(profile, requester);

    if (!profile.photoKey) throw new NotFoundException('No photo set for this candidate.');

    try {
      const buffer = await fs.readFile(join(UPLOAD_DIR, profile.photoKey));
      return { buffer, contentType: this.contentTypeFor(profile.photoKey) };
    } catch {
      throw new NotFoundException('Stored photo could not be read.');
    }
  }

  /**
   * Phase 1 access rule was "only the candidate themself." Phase 2 (this
   * check): an employer may also view it once they have a legitimate
   * relationship to the candidate — the same employerCanViewCandidate
   * check gating the resume endpoint (JobsService.getApplicantResume),
   * not a separate one, so "can this employer see this candidate's private
   * artifacts" can never disagree between photo and resume.
   *
   * Deliberately NOT "any authenticated user" or "any EMPLOYER_* role
   * regardless of relationship" — that would let one employer view photos
   * of candidates who have never interacted with their org. A role check
   * runs first only as an optimization (skip the relationship query for
   * non-employers); it is never sufficient on its own.
   */
  private async assertCanViewPhoto(profile: CandidateProfile, requester: Requester): Promise<void> {
    if (profile.userId === requester.sub) return;

    const isEmployer = requester.role === Role.EMPLOYER_ADMIN || requester.role === Role.EMPLOYER_MEMBER;
    if (isEmployer) {
      const membership = await this.prisma.orgMember.findUnique({ where: { userId: requester.sub } });
      if (membership && (await this.employerAccess.employerCanViewCandidate(membership.organizationId, profile.id))) {
        return;
      }
    }
    throw new ForbiddenException();
  }

  private contentTypeFor(filename: string): string {
    return PHOTO_CONTENT_TYPE_BY_EXTENSION[extname(filename).toLowerCase()] ?? 'application/octet-stream';
  }

  /** Best-effort — a file already missing on disk (manual cleanup, an
   * ephemeral-disk redeploy wipe, see UPLOAD_DIR's doc comment) shouldn't
   * block clearing or replacing the DB pointer. */
  private async deleteStoredFile(filename: string): Promise<void> {
    try {
      await fs.unlink(join(UPLOAD_DIR, filename));
    } catch {
      // Ignored — see doc comment above.
    }
  }

  private async ensureProfile(userId: string) {
    const existing = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.candidateProfile.create({ data: { userId } });
  }

  /** Never trust client-supplied completeness — always derive it server-side. */
  private computeCompleteness(profile: CompletenessFields): number {
    const fields: unknown[] = [
      profile.fullName,
      profile.headline,
      profile.location,
      profile.yearsOfExp,
      profile.githubUrl,
      profile.linkedinUrl,
      profile.email,
    ];
    const filled = fields.filter((v) => v !== null && v !== undefined && v !== '').length;
    return Math.round((filled / fields.length) * 100);
  }
}
