import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExternalCredentialsController } from './external-credentials.controller';
import { ExternalCredentialsService } from './external-credentials.service';
import { CredlyVerificationService } from './credly-verification.service';

@Module({
  imports: [AuthModule],
  controllers: [ExternalCredentialsController],
  providers: [ExternalCredentialsService, CredlyVerificationService],
})
export class ExternalCredentialsModule {}
