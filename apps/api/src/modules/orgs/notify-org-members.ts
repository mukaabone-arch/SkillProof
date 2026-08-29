import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Emails every current OrgMember of an organization — shared by
 * OrgsService.deactivate and AdminService.reactivateOrg, the two places an
 * org-wide state change (not just the acting admin) needs everyone told,
 * not only whoever triggered it — "every OrgMember loses access" means
 * every OrgMember hears about it too.
 */
export async function notifyOrgMembers(
  prisma: PrismaService,
  notifications: NotificationsService,
  organizationId: string,
  type: NotificationType,
  subject: string,
  html: string,
): Promise<void> {
  const members = await prisma.orgMember.findMany({
    where: { organizationId },
    select: { userId: true },
  });
  for (const member of members) {
    await notifications.sendEmail(member.userId, type, subject, html);
  }
}
