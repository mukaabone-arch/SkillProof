import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { promises as fs, mkdirSync } from 'fs';
import { join } from 'path';
import { UPLOAD_DIR } from '../config/upload-dir';
import { API_BASE_URL } from '../config/api-base-url';
import { StorageService } from './storage.interface';

/** Signed-token payload minted by getPresignedDownloadUrl and verified by LocalStorageController. */
export interface LocalDownloadTokenPayload {
  key: string;
  filename: string;
  purpose: 'local-file-download';
}

/**
 * Local-disk StorageService for dev, so working on this codebase never
 * requires AWS credentials. Mirrors S3StorageService's contract exactly,
 * including "download link" semantics — since a bare filesystem path can't
 * be handed to a browser, getPresignedDownloadUrl mints a short-lived JWT
 * (reusing JWT_SECRET, same signing infra as JwtAuthGuard) and points at
 * LocalStorageController's token-gated route instead of a real presigned
 * URL.
 */
@Injectable()
export class LocalDiskStorageService implements StorageService {
  constructor(private readonly jwt: JwtService) {}

  async write(key: string, buffer: Buffer): Promise<void> {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(join(UPLOAD_DIR, key), buffer);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(join(UPLOAD_DIR, key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(join(UPLOAD_DIR, key));
  }

  async getPresignedDownloadUrl(
    key: string,
    { filename, expiresInSeconds = 900 }: { filename: string; expiresInSeconds?: number },
  ): Promise<string> {
    const payload: LocalDownloadTokenPayload = { key, filename, purpose: 'local-file-download' };
    const token = await this.jwt.signAsync(payload, { expiresIn: expiresInSeconds });
    return `${API_BASE_URL}/internal/local-storage/download?token=${encodeURIComponent(token)}`;
  }
}
