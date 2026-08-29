import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { OrgMemberGuard } from './org-member.guard';
import { OrgSetupCompleteGuard } from './org-setup-complete.guard';
import { OrgActiveGuard } from './org-active.guard';
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
    OrgActiveGuard,
    CandidateVerificationGuard,
    GoogleOAuthProvider,
    GithubOAuthProvider,
  ],
  // CandidateVerificationGuard and OrgActiveGuard must both be exported
  // even though nothing injects them directly except JwtAuthGuard/
  // OrgMemberGuard (same module) — every OTHER module that uses
  // @UseGuards(JwtAuthGuard) or @UseGuards(..., OrgMemberGuard) needs Nest
  // to resolve THEIR constructor dependencies from ITS OWN consuming
  // context, which requires these to be visible there too. Omitting this
  // breaks Nest's DI resolution (and therefore app boot) in every module
  // other than AuthModule itself — this exact class of bug already slipped
  // past this repo's unit tests once (CandidateVerificationGuard, caught
  // only via a real container boot), since none of them exercise real
  // cross-module Nest DI wiring — see auth-cross-module-di.spec.ts, added after
  // that incident specifically to catch this for every exported guard.
  exports: [
    JwtAuthGuard,
    RolesGuard,
    OrgMemberGuard,
    OrgSetupCompleteGuard,
    OrgActiveGuard,
    CandidateVerificationGuard,
    JwtModule,
  ],
})
export class AuthModule {}
