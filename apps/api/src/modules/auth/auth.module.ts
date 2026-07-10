import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { OrgMemberGuard } from './org-member.guard';
import { GoogleOAuthProvider } from './oauth/google-oauth.provider';
import { GithubOAuthProvider } from './oauth/github-oauth.provider';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, OrgMemberGuard, GoogleOAuthProvider, GithubOAuthProvider],
  exports: [JwtAuthGuard, RolesGuard, OrgMemberGuard, JwtModule],
})
export class AuthModule {}
