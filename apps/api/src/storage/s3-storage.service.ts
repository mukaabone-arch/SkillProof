import { Injectable } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.interface';

/**
 * S3-backed StorageService for production. Credentials and region come from
 * the SDK's default provider chain (env vars, shared config, or — on
 * Render/ECS/EC2 — an attached IAM role); nothing to configure here beyond
 * the bucket name. Downloads are always presigned GETs, never a public
 * object — see getPresignedDownloadUrl.
 */
@Injectable()
export class S3StorageService implements StorageService {
  private readonly client = new S3Client({});
  private readonly bucket: string;

  constructor() {
    const bucket = process.env.S3_UPLOAD_BUCKET;
    if (!bucket) {
      throw new Error('S3_UPLOAD_BUCKET must be set when STORAGE_DRIVER=s3');
    }
    this.bucket = bucket;
  }

  async write(key: string, buffer: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`S3 object ${key} has no body`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getPresignedDownloadUrl(
    key: string,
    { filename, expiresInSeconds = 900 }: { filename: string; expiresInSeconds?: number },
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
