import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { STORAGE_SERVICE, StorageService } from '../../storage/storage.interface';
import { CertificationsService, UploadedCertFile } from './certifications.service';
import { CertificationFieldsDto } from './certifications.dto';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Same "extension keyed by mimetype" convention as ProfilesController's resume/photo uploads. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

const FILE_INTERCEPTOR_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (!(file.mimetype in EXTENSION_BY_MIME)) {
      return cb(new BadRequestException('Only PDF, PNG, or JPG files are accepted'), false);
    }
    cb(null, true);
  },
};

/**
 * REST API for the candidate's certifications — the multi-issuer successor
 * to /profiles/me/external-credentials (still live, untouched, for its
 * existing Credly-only rows; see Certification's doc comment in
 * schema.prisma). Consumed by both the web profile page and the mobile app,
 * so the response shape (CertificationDto in certifications.service.ts) is
 * a stable contract:
 *
 *   {
 *     id, name, issuer, issuerOther, issueDate, expiryDate, credentialId,
 *     credentialUrl, fileUrl, verificationStatus, verificationSource,
 *     skillTags, isExpiringSoon, createdAt, updatedAt
 *   }
 *
 * issuer is one of: CREDLY | COURSERA | LINKEDIN_LEARNING | PMI |
 * PEOPLECERT | AWS | MICROSOFT | GOOGLE | SCRUM_ALLIANCE | UDEMY | EDX |
 * NPTEL | OTHER. verificationStatus is one of: VERIFIED | LINK_PROVIDED |
 * SELF_REPORTED | EXPIRED. verificationSource is one of: CREDLY | URL |
 * MANUAL_UPLOAD. fileUrl, when non-null, is an authenticated proxy path
 * (GET .../:id/file) — never a raw storage key or public URL.
 *
 * Create/update are multipart/form-data (the optional file upload lives
 * alongside the text fields) — skillTags must be sent as a JSON-encoded
 * array string (e.g. '["<skillId>","<skillId>"]'), same reasoning as any
 * other array field on a FormData body.
 */
@Controller('profiles/me/certifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class CertificationsController {
  constructor(
    private readonly svc: CertificationsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.svc.list(req.user.sub);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', FILE_INTERCEPTOR_OPTIONS))
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CertificationFieldsDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const upload = await this.storeUpload(file);
    return this.svc.create(req.user.sub, dto, upload);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('file', FILE_INTERCEPTOR_OPTIONS))
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CertificationFieldsDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const upload = await this.storeUpload(file);
    return this.svc.update(req.user.sub, id, dto, upload);
  }

  /** Writes the multipart file (if any) to storage and returns the key CertificationsService should persist as fileUrl. */
  private async storeUpload(file: Express.Multer.File | undefined): Promise<UploadedCertFile | undefined> {
    if (!file) return undefined;
    const key = `${randomUUID()}${EXTENSION_BY_MIME[file.mimetype]}`;
    await this.storage.write(key, file.buffer, file.mimetype);
    return { key };
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.remove(req.user.sub, id);
  }

  @Get(':id/file')
  @Header('Cache-Control', 'private, max-age=300')
  async getFile(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { buffer, contentType } = await this.svc.getFile(req.user.sub, id);
    return new StreamableFile(buffer, { type: contentType, disposition: 'inline' });
  }
}
