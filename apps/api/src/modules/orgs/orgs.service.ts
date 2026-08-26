import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { extname } from 'path';
import { OrgVerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_SERVICE, StorageService } from '../../storage/storage.interface';
import { UpdateOrgDto } from './orgs.dto';

/** Same convention as ProfilesController's PHOTO_EXTENSION_BY_MIME, inverted for read-back — every key OrgsController's fileFilter accepts has an entry here. */
const LOGO_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Storage key is never returned to a client — same masking as ProfilesService.withHasPhoto. */
function withHasLogo<T extends { logoKey: string | null }>(org: T): Omit<T, 'logoKey'> & { hasLogo: boolean } {
  const { logoKey, ...rest } = org;
  return { ...rest, hasLogo: logoKey != null };
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async update(orgId: string, dto: UpdateOrgDto) {
    const updated = await this.prisma.organization.update({ where: { id: orgId }, data: dto });
    return withHasLogo(updated);
  }

  /** Replaces the stored logo, deleting the previous file first — same "don't accumulate unreferenced files" rule as ProfilesService.savePhoto. */
  async saveLogo(orgId: string, key: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.logoKey) await this.deleteStoredFile(org.logoKey);
    const updated = await this.prisma.organization.update({ where: { id: orgId }, data: { logoKey: key } });
    return withHasLogo(updated);
  }

  /**
   * Employer-admin-initiated. Moves UNVERIFIED or REJECTED -> PENDING for
   * an admin to decide (see OrgVerificationStatus). Also covers a
   * REJECTED org's resubmission after fixing whatever the admin flagged —
   * the prior decision fields are cleared here so a stale rejectionReason
   * never sits alongside a fresh PENDING review (see Organization's own
   * doc comment on those fields).
   */
  async submitForVerification(orgId: string, userId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.verificationStatus === OrgVerificationStatus.PENDING) {
      throw new ConflictException('Verification is already pending review.');
    }
    if (org.verificationStatus === OrgVerificationStatus.VERIFIED) {
      throw new ConflictException('This organization is already verified.');
    }

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        verificationStatus: OrgVerificationStatus.PENDING,
        verificationSubmittedAt: new Date(),
        verificationSubmittedByUserId: userId,
        verifiedAt: null,
        verifiedByUserId: null,
        rejectionReason: null,
      },
    });
    return withHasLogo(updated);
  }

  async deleteLogo(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.logoKey) await this.deleteStoredFile(org.logoKey);
    const updated = await this.prisma.organization.update({ where: { id: orgId }, data: { logoKey: null } });
    return withHasLogo(updated);
  }

  /**
   * GET /orgs/:id/logo. `callerOrgId` comes from OrgMemberGuard (the
   * requester's own membership, resolved server-side from their JWT — never
   * trusted from the URL); `orgId` is the :id param. Any member of an org
   * may view that org's own logo, but never another org's — there's no
   * legitimate cross-org logo access in this feature (unlike candidate
   * photos, which an employer may view for an applicant relationship — a
   * logo has no equivalent relationship to check, so same-org is the whole
   * rule).
   */
  async getLogoForViewing(orgId: string): Promise<{ buffer: Buffer; contentType: string }> {

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException();
    if (!org.logoKey) throw new NotFoundException('No logo set for this organization.');

    try {
      const buffer = await this.storage.read(org.logoKey);
      return { buffer, contentType: this.contentTypeFor(org.logoKey) };
    } catch {
      throw new NotFoundException('Stored logo could not be read.');
    }
  }

  private contentTypeFor(filename: string): string {
    return LOGO_CONTENT_TYPE_BY_EXTENSION[extname(filename).toLowerCase()] ?? 'application/octet-stream';
  }

  /** Best-effort — a file already missing in storage shouldn't block clearing or replacing the DB pointer. Same reasoning as ProfilesService.deleteStoredFile. */
  private async deleteStoredFile(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      // Ignored — see doc comment above.
    }
  }
}
