// One-off promotion script — no admin UI or seed can create the first admin.
// Run from apps/api:  npx ts-node prisma/make-admin.ts +91XXXXXXXXXX
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Usage: npx ts-node prisma/make-admin.ts <phone>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    console.error(`No user found with phone ${phone}. Log in once via OTP first, then re-run this.`);
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'PLATFORM_ADMIN' },
  });
  console.log(`${updated.phone} (${updated.id}) is now PLATFORM_ADMIN.`);
}

main().finally(() => prisma.$disconnect());
