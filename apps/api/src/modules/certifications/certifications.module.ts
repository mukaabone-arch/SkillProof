import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExternalCredentialsModule } from '../external-credentials/external-credentials.module';
import { CertificationsController } from './certifications.controller';
import { CertificationsService } from './certifications.service';

@Module({
  // ExternalCredentialsModule is imported only for its exported
  // CredlyVerificationService — Credly is one issuer option among many
  // here, see CertificationsService.determineVerification.
  imports: [AuthModule, ExternalCredentialsModule],
  controllers: [CertificationsController],
  providers: [CertificationsService],
})
export class CertificationsModule {}
