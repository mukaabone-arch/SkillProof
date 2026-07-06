import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CandidateProfile } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { UpdateProfileDto } from './profiles.dto';

type CompletenessFields = Pick<
  CandidateProfile,
  'fullName' | 'headline' | 'location' | 'yearsOfExp' | 'githubUrl' | 'linkedinUrl'
>;

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async getMe(userId: string) {
    return this.ensureProfile(userId);
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const existing = await this.ensureProfile(userId);
    const merged: CompletenessFields = { ...existing, ...dto };

    return this.prisma.candidateProfile.update({
      where: { userId },
      data: { ...dto, completeness: this.computeCompleteness(merged) },
    });
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
    ];
    const filled = fields.filter((v) => v !== null && v !== undefined && v !== '').length;
    return Math.round((filled / fields.length) * 100);
  }
}
