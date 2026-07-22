import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExternalCredentialsController } from './external-credentials.controller';
import { ExternalCredentialsService } from './external-credentials.service';
import { CredlyVerificationService } from './credly-verification.service';

@Module({
  imports: [AuthModule],
  controllers: [ExternalCredentialsController],
  providers: [ExternalCredentialsService, CredlyVerificationService],
  // CredlyVerificationService is reused by CertificationsModule, which offers
  // Credly as one issuer among many in the unified Certification form — see
  // CertificationsService.determineVerification.
  exports: [CredlyVerificationService],
})
export class ExternalCredentialsModule {}
