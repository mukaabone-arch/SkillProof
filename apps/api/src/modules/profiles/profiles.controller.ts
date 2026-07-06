import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
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
import { UpdateProfileDto } from './profiles.dto';

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
}
