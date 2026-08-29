import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule } from './auth.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { OrgMemberGuard } from './org-member.guard';
import { OrgSetupCompleteGuard } from './org-setup-complete.guard';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * Regression guard for a real incident: JwtAuthGuard delegates to
 * CandidateVerificationGuard, and OrgMemberGuard delegates to
 * OrgActiveGuard (both same-module collaborators, see those guards' own
 * doc comments) — but a guard used via @UseGuards(SomeGuardClass) is
 * resolved through the CONSUMING module's own DI context, so any guard it
 * depends on internally must ALSO be exported from AuthModule, or Nest
 * fails to construct it anywhere outside AuthModule itself. This exact
 * gap (CandidateVerificationGuard not exported) shipped once and only
 * surfaced via a real container boot — no unit test caught it, since none
 * of this repo's specs exercise real cross-module Nest DI wiring.
 *
 * This test does: spins up a throwaway controller in its OWN module (never
 * AuthModule) that uses every guard AuthModule exports, exactly the way a
 * real consuming module (UsersModule, JobsModule, ...) does, and compiles
 * it for real through Nest's DI container. No mocking of AuthModule's own
 * providers — the whole point is to prove the real module's export list is
 * complete. Deliberately does NOT call .init() (which would run
 * onModuleInit → PrismaService.$connect()) — .compile() alone fully
 * resolves and constructs the provider graph, which is exactly what a
 * missing @Module({ exports: [...] }) entry breaks, with no DB needed.
 */
@Controller('probe')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard)
class ProbeController {
  @Get()
  ping() {
    return 'ok';
  }
}

@Module({
  // PrismaModule is @Global() in the real app, but that only takes effect
  // once it's actually part of the compiled graph — this isolated test
  // module never goes through AppModule, so it has to be imported
  // explicitly here, or PrismaService (a dependency of OrgMemberGuard/
  // OrgActiveGuard/etc.) fails to resolve for a reason that has nothing to
  // do with what this test actually checks.
  imports: [AuthModule, PrismaModule],
  controllers: [ProbeController],
})
class ProbeModule {}

describe('AuthModule exported guards — real cross-module DI resolution', () => {
  it('compiles a consuming module that uses every exported guard, with no DB connection', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    expect(moduleRef).toBeDefined();
  });
});
