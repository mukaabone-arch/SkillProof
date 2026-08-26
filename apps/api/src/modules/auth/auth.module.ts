import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { OrgMemberGuard } from './org-member.guard';
import { OrgSetupCompleteGuard } from './org-setup-complete.guard';
import { CandidateVerificationGuard } from './candidate-verification.guard';
import { GoogleOAuthProvider } from './oauth/google-oauth.provider';
import { GithubOAuthProvider } from './oauth/github-oauth.provider';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' },
      }),
    }),
    // EMAIL_PROVIDER, for employer-signup OTP emails — see AuthService.sendOtpEmail.
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    OrgMemberGuard,
    OrgSetupCompleteGuard,
    CandidateVerificationGuard,
    GoogleOAuthProvider,
    GithubOAuthProvider,
  ],
  // CandidateVerificationGuard must be exported even though nothing injects
  // it directly except JwtAuthGuard (same module) — every OTHER module that
  // uses @UseGuards(JwtAuthGuard) needs Nest to resolve JwtAuthGuard's own
  // constructor dependencies from ITS consuming context, which requires
  // CandidateVerificationGuard to be visible there too. Omitting this
  // breaks Nest's DI resolution (and therefore app boot) in every module
  // other than AuthModule itself — caught via a real container boot, not
  // by any of this repo's existing unit tests, since none of them exercise
  // real cross-module Nest DI wiring.
  exports: [JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard, CandidateVerificationGuard, JwtModule],
})
export class AuthModule {}
