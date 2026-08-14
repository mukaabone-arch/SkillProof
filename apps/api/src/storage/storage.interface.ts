/**
 * Storage abstraction shared by every module that persists an uploaded or
 * generated file (resumes, profile photos, certification files, data
 * exports). Two implementations sit behind this: LocalDiskStorageService
 * (dev, no AWS credentials needed) and S3StorageService (prod), selected by
 * STORAGE_DRIVER in StorageModule. Every caller stores/reads/deletes by a
 * bare key — never a path or URL — so the same key works against either
 * backend.
 */
export interface StorageService {
  write(key: string, buffer: Buffer, contentType?: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /**
   * A time-limited URL a browser can download `key` from directly, without
   * proxying bytes through the API. `filename` becomes the downloaded
   * file's name via Content-Disposition.
   */
  getPresignedDownloadUrl(
    key: string,
    opts: { filename: string; expiresInSeconds?: number },
  ): Promise<string>;
}

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');
