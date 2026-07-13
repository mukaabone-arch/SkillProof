import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CredentialVerificationState, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CredlyVerificationService } from './credly-verification.service';
import { CreateExternalCredentialDto } from './external-credentials.dto';
import { computeNameMatchState } from './name-match.util';

@Injectable()
export class ExternalCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credly: CredlyVerificationService,
  ) {}

  /** Always creates the row (PENDING baseline), then attempts verification synchronously before returning. */
  async create(userId: string, dto: CreateExternalCredentialDto) {
    const profile = await this.ensureProfile(userId);
    const result = await this.credly.verify(dto.credentialUrl);
    // Advisory-only, per NameMatchState — never affects result.state above.
    const nameMatchState = computeNameMatchState(result.holderName, profile.fullName);

    try {
      return await this.prisma.externalCredential.create({
        data: {
          profileId: profile.id,
          credentialUrl: dto.credentialUrl,
          issuer: result.issuer,
          name: result.name,
          verificationState: result.state,
          nameMatchState,
          verifiedAt: result.state === CredentialVerificationState.VERIFIED ? new Date() : null,
          externalId: result.externalId,
          issuedAt: result.issuedAt,
          expiresAt: result.expiresAt,
          rawMetadata: result.rawMetadata === null ? Prisma.DbNull : result.rawMetadata,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You have already added this credential URL.');
      }
      throw err;
    }
  }

  async list(userId: string) {
    const profile = await this.ensureProfile(userId);
    return this.prisma.externalCredential.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Returns the deleted id (rather than void) so the response body isn't empty — callers can't rely on res.json() otherwise. */
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const profile = await this.ensureProfile(userId);
    const credential = await this.prisma.externalCredential.findUnique({ where: { id } });
    if (!credential || credential.profileId !== profile.id) {
      throw new NotFoundException('External credential not found');
    }
    await this.prisma.externalCredential.delete({ where: { id } });
    return { id };
  }

  private async ensureProfile(userId: string) {
    const existing = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.candidateProfile.create({ data: { userId } });
  }
}
