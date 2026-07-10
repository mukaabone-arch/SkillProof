// One-off promotion script — no admin UI or seed can create the first admin.
// Run from apps/api:  npx ts-node prisma/make-admin.ts +91XXXXXXXXXX
// or, for a Google/GitHub-only user (no phone on file): npx ts-node prisma/make-admin.ts someone@example.com
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error('Usage: npx ts-node prisma/make-admin.ts <phone-or-email>');
    process.exit(1);
  }

  const user = await prisma.user.findFirst({ where: { OR: [{ phone: identifier }, { email: identifier }] } });
  if (!user) {
    console.error(
      `No user found with phone/email ${identifier}. Log in once (any provider) first, then re-run this.`,
    );
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'PLATFORM_ADMIN' },
  });
  console.log(`${updated.phone ?? updated.email} (${updated.id}) is now PLATFORM_ADMIN.`);
}

main().finally(() => prisma.$disconnect());
