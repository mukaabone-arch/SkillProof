import { Injectable } from '@nestjs/common';
import { CandidateProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './profiles.dto';

type CompletenessFields = Pick<
  CandidateProfile,
  'fullName' | 'headline' | 'location' | 'yearsOfExp' | 'githubUrl' | 'linkedinUrl'
>;

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

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
