import { Prisma } from '@prisma/client';

/**
 * Generates the next MYA-EMP-####-style display code for a newly-created
 * Organization, from `organization_code_seq` (see the add_organization_code
 * migration and Organization.code's own doc comment). A plain function
 * rather than a service method so every org-creation path — today just
 * AuthService.createEmployer — can call it inside its own `$transaction`
 * without a cross-module dependency on OrgsService.
 */
export async function generateOrgCode(tx: Prisma.TransactionClient): Promise<string> {
  const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('organization_code_seq')`;
  return `MYA-EMP-${nextval.toString().padStart(4, '0')}`;
}
