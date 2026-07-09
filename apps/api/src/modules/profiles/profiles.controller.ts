import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ProfilesService } from './profiles.service';
import { GenerateResumeDto, UpdateProfileDto } from './profiles.dto';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

@Controller('profiles')
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(private readonly svc: ProfilesService) {}

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
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, _file, cb) => cb(null, `${randomUUID()}.pdf`),
      }),
      limits: { fileSize: MAX_RESUME_BYTES },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Only PDF files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadResume(@Req() req: AuthenticatedRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.svc.saveResume(req.user.sub, `uploads/${file.filename}`);
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
}
