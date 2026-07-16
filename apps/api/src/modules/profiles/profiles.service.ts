import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CandidateProfile, ClaimStatus, Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { GenerateResumeDto, UpdateProfileDto } from './profiles.dto';
import { buildResumePdf, VerifiedSkillEntry } from './resume-pdf.builder';
import { UPLOAD_DIR } from '../../config/upload-dir';

type CompletenessFields = Pick<
  CandidateProfile,
  'fullName' | 'headline' | 'location' | 'yearsOfExp' | 'githubUrl' | 'linkedinUrl'
> & { email: string | null };

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async getMe(userId: string) {
    const [profile, email] = await Promise.all([this.ensureProfile(userId), this.getEmail(userId)]);
    return { ...profile, email };
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
    return { ...updated, email: currentEmail };
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
    try {
      return await fs.readFile(join(UPLOAD_DIR, profile.resumeS3Key));
    } catch {
      throw new NotFoundException('Stored resume file could not be read. Try re-uploading.');
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
