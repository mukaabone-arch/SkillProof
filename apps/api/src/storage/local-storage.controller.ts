import { Controller, ForbiddenException, Get, Query, StreamableFile } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LocalDiskStorageService, LocalDownloadTokenPayload } from './local-disk-storage.service';

/**
 * Dev-only counterpart to an S3 presigned URL — see
 * LocalDiskStorageService.getPresignedDownloadUrl. Deliberately outside
 * JwtAuthGuard: this route is meant for direct browser navigation (no
 * Authorization header on a plain link click), so the query-string token
 * itself — short-lived, HMAC-signed with JWT_SECRET, single-purpose — is
 * the only auth. Registered unconditionally; with STORAGE_DRIVER=s3 nothing
 * ever links here, so it's inert.
 */
@Controller('internal/local-storage')
export class LocalStorageController {
  constructor(
    private readonly jwt: JwtService,
    private readonly storage: LocalDiskStorageService,
  ) {}

  @Get('download')
  async download(@Query('token') token: string): Promise<StreamableFile> {
    let payload: LocalDownloadTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<LocalDownloadTokenPayload>(token);
    } catch {
      throw new ForbiddenException('Invalid or expired download link.');
    }
    if (payload.purpose !== 'local-file-download') {
      throw new ForbiddenException('Invalid or expired download link.');
    }

    const buffer = await this.storage.read(payload.key);
    return new StreamableFile(buffer, {
      disposition: `attachment; filename="${payload.filename}"`,
    });
  }
}
