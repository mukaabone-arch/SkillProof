/**
 * Throwaway verification helper (not wired into the app): seeds ONE real
 * expired badge — a genuine Badge row with expiresAt in the past and
 * revokedAt null — so the public certificate page (/badges/[hash]) can be
 * checked against a real, non-revoked, lapsed credential. Idempotent: every
 * entity is upserted by a unique key, so re-running just refreshes the same
 * rows. Prints the shareable verify hash and the shape verifyBadge returns.
 *
 * Run:  npx ts-node prisma/seed-expired-badge.ts
 * Then: curl http://localhost:4000/badges/verify/<hash>
 */
import { PrismaClient, BadgeVerificationMethod, SkillLevel } from '@prisma/client';

const prisma = new PrismaClient();
const HASH = 'expiredbadgeverify0001';

async function main() {
  const domain = await prisma.domain.upsert({
    where: { name: 'Verification Fixtures' },
    update: {},
    create: { name: 'Verification Fixtures' },
  });

  const skill = await prisma.skill.upsert({
    where: { domainId_name: { domainId: domain.id, name: 'Expired Badge Skill' } },
    update: {},
    create: { domainId: domain.id, name: 'Expired Badge Skill' },
  });

  const user = await prisma.user.upsert({
    where: { email: 'expired-badge-fixture@skillproof.test' },
    update: {},
    create: { email: 'expired-badge-fixture@skillproof.test' },
  });

  await prisma.candidateProfile.upsert({
    where: { userId: user.id },
    update: { fullName: 'Ada Fixture' },
    create: { userId: user.id, fullName: 'Ada Fixture' },
  });

  const issuedAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // ~13 months ago
  const expiresAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // lapsed 30 days ago

  const badge = await prisma.badge.upsert({
    where: { verifyHash: HASH },
    update: { issuedAt, expiresAt, revokedAt: null },
    create: {
      userId: user.id,
      skillId: skill.id,
      verifiedBy: BadgeVerificationMethod.TEST,
      verifyHash: HASH,
      level: SkillLevel.L2,
      issuedAt,
      expiresAt,
      attemptNumber: 1,
    },
  });

  console.log('Seeded expired badge:');
  console.log({
    verifyHash: badge.verifyHash,
    issuedAt: badge.issuedAt.toISOString(),
    expiresAt: badge.expiresAt.toISOString(),
    revokedAt: badge.revokedAt,
    expiredNow: badge.expiresAt < new Date(),
    valid: badge.expiresAt > new Date(),
  });
  console.log(`\nVerify at: /badges/${HASH}  (API: GET /badges/verify/${HASH})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
