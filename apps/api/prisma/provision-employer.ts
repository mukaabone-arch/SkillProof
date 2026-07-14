// One-off manual employer-provisioning script — employer accounts aren't
// self-serve yet (no OAuth/OTP flow auto-creates an org or promotes a role),
// so turning an existing user into an employer is a manual DB operation.
// Run from apps/api:  npx ts-node prisma/provision-employer.ts <email> <orgName>
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

// Matches normalizeEmail() in src/modules/auth/normalize-email.ts — User.email
// is always stored lowercased, so the lookup below has to match that.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function main() {
  const [, , rawEmail, orgName] = process.argv;

  if (!rawEmail || !orgName) {
    console.error('Usage: npx ts-node prisma/provision-employer.ts <email> <orgName>');
    process.exit(1);
  }

  const email = normalizeEmail(rawEmail);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(
      `No user found with email ${email}. They must sign in first (via the employer login) to create their account, then re-run this.`,
    );
    process.exit(1);
  }

  // Everything below is one transaction so a failure partway through (e.g.
  // the OrgMember write) can't leave the role flipped to EMPLOYER_ADMIN with
  // no org attached, or an org created with no member linked to it.
  const { organization, member, reusedExistingMember } = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { role: Role.EMPLOYER_ADMIN },
    });

    // Org names aren't unique in the schema, so this is a best-effort reuse
    // (first match) rather than a hard lookup key — fine for a manual,
    // human-operated script; just means re-running with the exact same
    // orgName won't spawn a duplicate Organization row.
    let organization = await tx.organization.findFirst({ where: { name: orgName } });
    if (!organization) {
      organization = await tx.organization.create({ data: { name: orgName } });
    }

    // OrgMember.userId is @unique — a plain create() would throw on re-run
    // (or if this user was already provisioned into a different org).
    // Update-if-exists keeps re-running the script safe either way.
    const existingMember = await tx.orgMember.findUnique({ where: { userId: user.id } });
    const member = existingMember
      ? await tx.orgMember.update({
          where: { userId: user.id },
          data: { organizationId: organization.id },
        })
      : await tx.orgMember.create({
          data: { userId: user.id, organizationId: organization.id },
        });

    return { organization, member, reusedExistingMember: !!existingMember };
  });

  if (reusedExistingMember) {
    console.log(`${email} already had an OrgMember record — repointed it to "${organization.name}".`);
  }

  console.log(
    `Provisioned ${email} as EMPLOYER_ADMIN of ${organization.name} (org id: ${organization.id}, member id: ${member.id}).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
