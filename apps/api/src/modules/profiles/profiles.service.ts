import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CandidateProfile, Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { UpdateProfileDto } from './profiles.dto';

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

  /** Records where the uploaded PDF landed on disk. Reuses CandidateProfile.resumeS3Key. */
  async saveResume(userId: string, relativePath: string) {
    await this.ensureProfile(userId);
    return this.prisma.candidateProfile.update({
      where: { userId },
      data: { resumeS3Key: relativePath },
    });
  }

  /**
   * Parses the candidate's already-uploaded resume with Claude and returns the
   * extracted fields for review — nothing is written to the profile here.
   */
  async parseResume(userId: string) {
    const profile = await this.ensureProfile(userId);
    if (!profile.resumeS3Key) {
      throw new BadRequestException('Upload a resume before parsing it.');
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await fs.readFile(join(process.cwd(), profile.resumeS3Key));
    } catch {
      throw new NotFoundException('Stored resume file could not be read. Try re-uploading.');
    }

    return this.llm.extractResumeFields(pdfBuffer.toString('base64'));
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
