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
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ProfilesService } from './profiles.service';
import { GenerateResumeDto, UpdateProfileDto } from './profiles.dto';
import { STORAGE_SERVICE, StorageService } from '../../storage/storage.interface';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Filename extension multer writes to disk for each accepted photo
 * mimetype. fileFilter below rejects anything else before this callback
 * ever runs, so every mimetype reaching it is guaranteed to be a key here
 * — same reasoning as resume's hardcoded `.pdf` above. */
const PHOTO_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Controller('profiles')
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(
    private readonly svc: ProfilesService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.svc.getMe(req.user.sub);
  }

  @Patch('me')
  update(@Req() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.svc.updateMe(req.user.sub, dto);
  }

  @Post('me/resume')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_RESUME_BYTES },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Only PDF files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadResume(@Req() req: AuthenticatedRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    // Bare storage key, resolved against the configured backend wherever
    // it's read back (ProfilesService.readStoredResume) — not a path
    // fragment baked around any one backend's layout.
    const key = `${randomUUID()}.pdf`;
    await this.storage.write(key, file.buffer, file.mimetype);
    return this.svc.saveResume(req.user.sub, key);
  }

  @Post('me/resume/parse')
  parseResume(@Req() req: AuthenticatedRequest) {
    return this.svc.parseResume(req.user.sub);
  }

  /** Rewrites the already-uploaded resume into structured, stronger content — review-only, never auto-saved. */
  @Post('me/resume/improve')
  improveResume(@Req() req: AuthenticatedRequest) {
    return this.svc.improveResume(req.user.sub);
  }

  /** Renders a one-page PDF from the profile + verified badges + optional improved content. */
  @Post('me/resume/generate')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="resume.pdf"')
  async generateResume(@Req() req: AuthenticatedRequest, @Body() dto: GenerateResumeDto) {
    const pdf = await this.svc.generateResumePdf(req.user.sub, dto);
    return new StreamableFile(pdf);
  }

  @Post('me/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!(file.mimetype in PHOTO_EXTENSION_BY_MIME)) {
          return cb(new BadRequestException('Only JPEG, PNG, or WebP images are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadPhoto(@Req() req: AuthenticatedRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    // Same key convention as uploadResume — a bare key resolved against
    // the configured backend wherever it's read back, not a path fragment
    // baked around any one backend's layout.
    const key = `${randomUUID()}${PHOTO_EXTENSION_BY_MIME[file.mimetype]}`;
    await this.storage.write(key, file.buffer, file.mimetype);
    return this.svc.savePhoto(req.user.sub, key);
  }

  @Delete('me/photo')
  deletePhoto(@Req() req: AuthenticatedRequest) {
    return this.svc.deletePhoto(req.user.sub);
  }

  /**
   * Proxy-serve only — the stored key is never handed to a client (see
   * ProfilesService.withHasPhoto), so this is the one path that can ever
   * turn a photoKey into bytes. `id` is CandidateProfile.id. Viewable by
   * the owner, or by an employer with a legitimate relationship to the
   * candidate — see ProfilesService.assertCanViewPhoto.
   */
  @Get(':id/photo')
  @Header('Cache-Control', 'private, max-age=300')
  async getPhoto(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { buffer, contentType } = await this.svc.getPhotoForViewing(id, req.user);
    return new StreamableFile(buffer, { type: contentType, disposition: 'inline' });
  }
}
