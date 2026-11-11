import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Agency postings and recruiter projects (hiring projects phase 2). A
 * recruiter (STAFFING org) posts every job, and runs every project, for one
 * of its own unarchived clients; an employer's jobs and projects are its own
 * and never carry a client. `required` is true wherever a recruiter must name
 * one (create, or a PATCH that sends the field: a client can be switched but
 * never cleared). Returns the org type so callers can branch on it.
 */
export async function assertOrgClient(
  prisma: PrismaService,
  orgId: string,
  clientId: string | null | undefined,
  required: boolean,
): Promise<OrgType> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { type: true } });
  const type = org.type ?? OrgType.EMPLOYER;
  if (type !== OrgType.STAFFING) {
    if (clientId) throw new BadRequestException('Only recruiters post jobs and run projects for a client.');
    return type;
  }
  if (!clientId) {
    if (required) throw new BadRequestException('Choose the client this is for.');
    return type;
  }
  const client = await prisma.staffingClient.findFirst({ where: { id: clientId, orgId, archivedAt: null }, select: { id: true } });
  if (!client) throw new NotFoundException('Client not found.');
  return type;
}
