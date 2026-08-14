import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LocalDiskStorageService } from './local-disk-storage.service';
import { LocalStorageController } from './local-storage.controller';
import { S3StorageService } from './s3-storage.service';
import { STORAGE_SERVICE } from './storage.interface';

/**
 * Global so every module injects StorageService the same way
 * (@Inject(STORAGE_SERVICE)) without each one importing this module
 * individually — imported once, in AppModule. Driver choice is read once
 * at boot: STORAGE_DRIVER=s3 uses S3StorageService (needs
 * S3_UPLOAD_BUCKET), anything else (including unset, for local dev) uses
 * LocalDiskStorageService.
 */
@Global()
@Module({
  imports: [
    // Separate JwtModule registration from AuthModule's — same JWT_SECRET,
    // but this one signs single-purpose local-file-download tokens with
    // their own short expiry (see LocalDiskStorageService), not access
    // tokens. Importing AuthModule here instead would also pull in its
    // controllers/OAuth providers for no reason.
    JwtModule.registerAsync({
      useFactory: () => ({ secret: process.env.JWT_SECRET }),
    }),
  ],
  controllers: [LocalStorageController],
  providers: [
    LocalDiskStorageService,
    {
      provide: STORAGE_SERVICE,
      useFactory: (local: LocalDiskStorageService) =>
        process.env.STORAGE_DRIVER === 's3' ? new S3StorageService() : local,
      inject: [LocalDiskStorageService],
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
