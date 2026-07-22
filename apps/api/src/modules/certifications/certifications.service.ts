import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CertIssuer,
  CertVerificationSource,
  CertVerificationStatus,
  Certification,
  CredentialVerificationState,
  Prisma,
} from '@prisma/client';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { UPLOAD_DIR } from '../../config/upload-dir';
import { CredlyVerificationService } from '../external-credentials/credly-verification.service';
import { CertificationFieldsDto } from './certifications.dto';

const UPCOMING_EXPIRY_WINDOW_DAYS = 60;

const FILE_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Shape returned to candidates (and mobile) — see this file's header comment for the stability contract. */
export interface CertificationDto {
  id: string;
  name: string;
  issuer: CertIssuer;
  issuerOther: string | null;
  issueDate: Date;
  expiryDate: Date | null;
  credentialId: string | null;
  credentialUrl: string | null;
  /**
   * The authenticated proxy path to fetch the file's bytes (never a raw
   * storage key, never a public URL) — null when no file was uploaded.
   * Mirrors GET /profiles/:id/photo's pattern; see Certification.fileUrl's
   * doc comment in schema.prisma for why the DB column and this API field
   * share a name but not a meaning.
   */
  fileUrl: string | null;
  verificationStatus: CertVerificationStatus;
  verificationSource: CertVerificationSource;
  skillTags: string[];
  /** True when expiryDate falls within the next 60 days and hasn't already lapsed into EXPIRED. */
  isExpiringSoon: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * REST API for the multi-issuer Certification model (Coursera, LinkedIn
 * Learning, PMI, PeopleCert, AWS, Microsoft, Google, Scrum Alliance, Udemy,
 * edX, NPTEL, Credly, or a free-text Other) — the successor to
 * ExternalCredentialsService for new writes. See Certification's doc
 * comment in schema.prisma for how it relates to the older, Credly-only
 * ExternalCredential table.
 */
@Injectable()
export class CertificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credly: CredlyVerificationService,
  ) {}

  async create(userId: string, dto: CertificationFieldsDto, file?: Express.Multer.File): Promise<CertificationDto> {
    const profile = await this.ensureProfile(userId);
    await this.assertHasProofOfCredential(dto, file);
    await this.assertSkillTagsExist(dto.skillTags);

    const { verificationStatus, verificationSource } = await this.determineVerification(dto, file);

    try {
      const created = await this.prisma.certification.create({
        data: {
          profileId: profile.id,
          name: dto.name,
          issuer: dto.issuer,
          issuerOther: dto.issuer === CertIssuer.OTHER ? dto.issuerOther ?? null : null,
          issueDate: new Date(dto.issueDate),
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          credentialId: dto.credentialId ?? null,
          credentialUrl: dto.credentialUrl ?? null,
          fileUrl: file?.filename ?? null,
          verificationStatus: this.applyExpiry(verificationStatus, dto.expiryDate),
          verificationSource,
          skillTags: dto.skillTags ?? [],
        },
      });
      return this.toDto(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You already have a certification with this credential URL.');
      }
      throw err;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: CertificationFieldsDto,
    file?: Express.Multer.File,
  ): Promise<CertificationDto> {
    const existing = await this.getOwned(userId, id);
    // Keep the previously-uploaded file unless this request attaches a new
    // one — the edit form resubmits every field, but a file input left
    // untouched sends nothing, not the original file back.
    const keepsExistingFile = !file && !!existing.fileUrl;
    await this.assertHasProofOfCredential(dto, file, keepsExistingFile);
    await this.assertSkillTagsExist(dto.skillTags);

    const { verificationStatus, verificationSource } = await this.determineVerification(
      dto,
      file,
      keepsExistingFile,
    );

    if (file && existing.fileUrl) {
      await this.deleteStoredFile(existing.fileUrl);
    }

    const updated = await this.prisma.certification.update({
      where: { id },
      data: {
        name: dto.name,
        issuer: dto.issuer,
        issuerOther: dto.issuer === CertIssuer.OTHER ? dto.issuerOther ?? null : null,
        issueDate: new Date(dto.issueDate),
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        credentialId: dto.credentialId ?? null,
        credentialUrl: dto.credentialUrl ?? null,
        fileUrl: file ? file.filename : keepsExistingFile ? existing.fileUrl : null,
        verificationStatus: this.applyExpiry(verificationStatus, dto.expiryDate),
        verificationSource,
        skillTags: dto.skillTags ?? [],
      },
    });
    return this.toDto(updated);
  }

  async list(userId: string): Promise<CertificationDto[]> {
    const profile = await this.ensureProfile(userId);
    await this.refreshExpired(profile.id);
    const rows = await this.prisma.certification.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.getOwned(userId, id);
    if (existing.fileUrl) await this.deleteStoredFile(existing.fileUrl);
    await this.prisma.certification.delete({ where: { id } });
    return { id };
  }

  /** Owner-only proxy read of the uploaded file's bytes — see CertificationDto.fileUrl's doc comment. */
  async getFile(userId: string, id: string): Promise<{ buffer: Buffer; contentType: string }> {
    const existing = await this.getOwned(userId, id);
    if (!existing.fileUrl) throw new NotFoundException('No file uploaded for this certification.');
    try {
      const buffer = await fs.readFile(join(UPLOAD_DIR, existing.fileUrl));
      const ext = extname(existing.fileUrl).toLowerCase();
      return { buffer, contentType: FILE_CONTENT_TYPE_BY_EXTENSION[ext] ?? 'application/octet-stream' };
    } catch {
      throw new NotFoundException('Stored file could not be read.');
    }
  }

  /**
   * Seam for a future admin-managed cert-name/issuer → skill-tags mapping
   * table (see Certification's doc comment in schema.prisma). Returns []
   * today — nothing calls this yet; it exists so that table can be wired in
   * later without changing create()'s shape.
   */
  async suggestSkillTags(_issuer: CertIssuer, _name: string): Promise<string[]> {
    return [];
  }

  /** "At least one of credential URL or file" — see the spec. keepsExistingFile covers edits that don't touch the file input. */
  private async assertHasProofOfCredential(
    dto: CertificationFieldsDto,
    file: Express.Multer.File | undefined,
    keepsExistingFile = false,
  ): Promise<void> {
    if (!dto.credentialUrl && !file && !keepsExistingFile) {
      throw new BadRequestException('Provide either a credential URL or an upload (PDF/PNG/JPG).');
    }
  }

  private async assertSkillTagsExist(skillTags: string[] | undefined): Promise<void> {
    if (!skillTags || skillTags.length === 0) return;
    const count = await this.prisma.skill.count({ where: { id: { in: skillTags } } });
    if (count !== new Set(skillTags).size) {
      throw new BadRequestException('One or more skill tags are not part of the current skill taxonomy.');
    }
  }

  /**
   * Decides verificationStatus/verificationSource from the submitted issuer,
   * credentialUrl, and file — the same rule for create and update:
   *   issuer=CREDLY + a credentialUrl that verifies live → VERIFIED / CREDLY
   *   (Credly URL given but verification fails/unsupported) → falls through
   *   credentialUrl present (any issuer) → LINK_PROVIDED / URL
   *   file present, no credentialUrl → SELF_REPORTED / MANUAL_UPLOAD
   * Expiry is applied afterwards by applyExpiry — this only decides the
   * intrinsic tier, not whether it's currently lapsed.
   */
  private async determineVerification(
    dto: CertificationFieldsDto,
    file: Express.Multer.File | undefined,
    keepsExistingFile = false,
  ): Promise<{ verificationStatus: CertVerificationStatus; verificationSource: CertVerificationSource }> {
    if (dto.issuer === CertIssuer.CREDLY && dto.credentialUrl) {
      const result = await this.credly.verify(dto.credentialUrl);
      if (result.state === CredentialVerificationState.VERIFIED) {
        return { verificationStatus: CertVerificationStatus.VERIFIED, verificationSource: CertVerificationSource.CREDLY };
      }
    }
    if (dto.credentialUrl) {
      return { verificationStatus: CertVerificationStatus.LINK_PROVIDED, verificationSource: CertVerificationSource.URL };
    }
    if (file || keepsExistingFile) {
      return {
        verificationStatus: CertVerificationStatus.SELF_REPORTED,
        verificationSource: CertVerificationSource.MANUAL_UPLOAD,
      };
    }
    // Unreachable in practice — assertHasProofOfCredential runs first and throws before we get here.
    return { verificationStatus: CertVerificationStatus.SELF_REPORTED, verificationSource: CertVerificationSource.MANUAL_UPLOAD };
  }

  /** A past expiryDate always wins over whatever tier determineVerification computed. */
  private applyExpiry(status: CertVerificationStatus, expiryDate: string | undefined): CertVerificationStatus {
    if (expiryDate && new Date(expiryDate).getTime() < Date.now()) {
      return CertVerificationStatus.EXPIRED;
    }
    return status;
  }

  /**
   * Lazily flips any row whose expiryDate has passed since it was last
   * written to EXPIRED, so verificationStatus is never stale when read —
   * there's no cron job for this, every list() call self-heals first. A
   * cert that starts EXPIRED can't un-expire on its own (that only happens
   * through an edit that changes/clears expiryDate), so this only ever
   * moves VERIFIED/LINK_PROVIDED/SELF_REPORTED forward into EXPIRED, never
   * the reverse.
   */
  private async refreshExpired(profileId: string): Promise<void> {
    await this.prisma.certification.updateMany({
      where: {
        profileId,
        expiryDate: { lt: new Date() },
        verificationStatus: { not: CertVerificationStatus.EXPIRED },
      },
      data: { verificationStatus: CertVerificationStatus.EXPIRED },
    });
  }

  private toDto(c: Certification): CertificationDto {
    const isExpiringSoon =
      c.verificationStatus !== CertVerificationStatus.EXPIRED &&
      !!c.expiryDate &&
      c.expiryDate.getTime() - Date.now() <= UPCOMING_EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    return {
      id: c.id,
      name: c.name,
      issuer: c.issuer,
      issuerOther: c.issuerOther,
      issueDate: c.issueDate,
      expiryDate: c.expiryDate,
      credentialId: c.credentialId,
      credentialUrl: c.credentialUrl,
      fileUrl: c.fileUrl ? `/profiles/me/certifications/${c.id}/file` : null,
      verificationStatus: c.verificationStatus,
      verificationSource: c.verificationSource,
      skillTags: c.skillTags,
      isExpiringSoon,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private async getOwned(userId: string, id: string): Promise<Certification> {
    const profile = await this.ensureProfile(userId);
    const cert = await this.prisma.certification.findUnique({ where: { id } });
    if (!cert || cert.profileId !== profile.id) {
      throw new NotFoundException('Certification not found');
    }
    return cert;
  }

  /** Best-effort — a file already missing on disk shouldn't block clearing or replacing the DB pointer. */
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
}
