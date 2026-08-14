import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrgInvitationStatus, Role, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { PLANS } from '../../config/plans.config';
import { EMAIL_PROVIDER, EmailProvider } from '../notifications/email-provider.interface';
import { normalizeEmail } from '../auth/normalize-email';

/** How long an invite stays acceptable before it lapses and stops counting against the seat cap. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Organizations have no subscription tier of their own (only CandidateProfile
 * does — see plans.config.ts's own doc comment on PlanLimits.maxOrgMembers).
 * FREE is just an arbitrary, stable key to read a shared, org-agnostic value
 * off PLANS — not a claim that employer orgs are on the free candidate tier.
 */
const ORG_PLAN_TIER = SubscriptionTier.FREE;

@Injectable()
export class OrgMembersService {
  private readonly logger = new Logger(OrgMembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Members plus outstanding invitations, with the seat count so the UI can
   * show "3 of 5 seats used" without a second round-trip. A PENDING
   * invitation whose expiresAt has passed is lazily flipped to EXPIRED here
   * — there's no cron sweep, so "list" is the one place that keeps stored
   * status in sync with the deadline every other check (seat counting,
   * accept) already treats as authoritative.
   */
  async list(orgId: string) {
    await this.expirePastDue(orgId);

    const [members, invitations] = await Promise.all([
      this.prisma.orgMember.findMany({
        where: { organizationId: orgId },
        include: { user: { select: { id: true, email: true, phone: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.orgInvitation.findMany({
        where: { organizationId: orgId, status: { in: [OrgInvitationStatus.PENDING, OrgInvitationStatus.EXPIRED] } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const seatLimit = PLANS[ORG_PLAN_TIER].maxOrgMembers;
    const seatsUsed = members.length + invitations.filter((i) => i.status === OrgInvitationStatus.PENDING).length;

    return {
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        phone: m.user.phone,
        role: m.user.role,
        joinedAt: m.createdAt,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        status: i.status,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
      seatLimit,
      seatsUsed,
      seatsRemaining: Math.max(0, seatLimit - seatsUsed),
    };
  }

  /**
   * Admin-only (enforced by the controller's @Roles, not here — see that
   * file's comment on why hiding a button is UX only). Creates a PENDING
   * invitation and emails a link to the acceptance page; the invitee proves
   * they own the address via email OTP there (AuthService.requestInviteOtp/
   * acceptInvite), not via a secret token in this row — see OrgInvitation's
   * own doc comment.
   */
  async invite(orgId: string, invitedByUserId: string, rawEmail: string) {
    await this.expirePastDue(orgId);
    const email = normalizeEmail(rawEmail);

    const existingMember = await this.prisma.orgMember.findFirst({
      where: { organizationId: orgId, user: { email } },
    });
    if (existingMember) throw new ConflictException('This email is already a member of your organization.');

    const existingInvite = await this.prisma.orgInvitation.findFirst({
      where: { organizationId: orgId, email, status: OrgInvitationStatus.PENDING },
    });
    if (existingInvite) throw new ConflictException('An invitation is already pending for this email.');

    const seatLimit = PLANS[ORG_PLAN_TIER].maxOrgMembers;
    const seatsUsed = await this.countUsedSeats(orgId);
    if (seatsUsed >= seatLimit) {
      throw new ConflictException(
        `Your organization has reached its ${seatLimit}-member seat limit. Remove a member or revoke a pending invitation to free a seat.`,
      );
    }

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const invitation = await this.prisma.orgInvitation.create({
      data: {
        organizationId: orgId,
        email,
        invitedByUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });

    const isDev = process.env.NODE_ENV !== 'production';
    try {
      if (isDev) {
        this.logger.log(`[DEV] Invite link for ${email} to join ${org.name}: ${WEB_BASE_URL}/employer-invite?email=${encodeURIComponent(email)}`);
      } else {
        await this.sendInviteEmail(email, org.name);
      }
    } catch (err) {
      // Same "fail loudly" contract as AuthService.sendOtpEmail — the
      // invitee has no other way to learn they were invited. Unlike an OTP
      // (whose rate-limit budget is allowed to absorb a failed send), this
      // row would otherwise sit there PENDING and block a same-email retry
      // via the "already pending" check above, so roll it back first.
      await this.prisma.orgInvitation.delete({ where: { id: invitation.id } });
      throw err;
    }

    return { id: invitation.id, email: invitation.email, status: invitation.status, expiresAt: invitation.expiresAt };
  }

  /** Admin-only. Frees the seat immediately rather than waiting out expiresAt — useful for a mistyped address. */
  async revokeInvitation(orgId: string, invitationId: string) {
    const invitation = await this.getOwnedInvitation(orgId, invitationId);
    if (invitation.status !== OrgInvitationStatus.PENDING) {
      throw new ConflictException('This invitation is no longer pending.');
    }
    await this.prisma.orgInvitation.update({
      where: { id: invitationId },
      data: { status: OrgInvitationStatus.REVOKED },
    });
    return { id: invitationId };
  }

  /** Admin-only. Blocked if the target is the org's last admin — see assertNotLastAdmin. */
  async remove(orgId: string, actingUserId: string, memberId: string) {
    const member = await this.getOwnedMember(orgId, memberId);
    await this.assertNotLastAdmin(orgId, member);
    await this.prisma.orgMember.delete({ where: { id: memberId } });
    return { id: memberId };
  }

  /** Admin-only. */
  async promote(orgId: string, memberId: string) {
    const member = await this.getOwnedMember(orgId, memberId);
    if (member.user.role === Role.EMPLOYER_ADMIN) {
      throw new ConflictException('This member is already an admin.');
    }
    await this.prisma.user.update({ where: { id: member.userId }, data: { role: Role.EMPLOYER_ADMIN } });
    return { id: memberId, role: Role.EMPLOYER_ADMIN };
  }

  /**
   * Admin-only. This is the one action that can strip an organization down
   * to zero admins if unguarded — assertNotLastAdmin is what makes that
   * impossible (see this task's own account-recovery framing: the sole
   * admin's org would otherwise become permanently unreachable the moment
   * they lose their email).
   */
  async demote(orgId: string, memberId: string) {
    const member = await this.getOwnedMember(orgId, memberId);
    if (member.user.role !== Role.EMPLOYER_ADMIN) {
      throw new ConflictException('This member is not an admin.');
    }
    await this.assertNotLastAdmin(orgId, member);
    await this.prisma.user.update({ where: { id: member.userId }, data: { role: Role.EMPLOYER_MEMBER } });
    return { id: memberId, role: Role.EMPLOYER_MEMBER };
  }

  /** Members (always occupied) plus not-yet-expired PENDING invitations (reserved). */
  private async countUsedSeats(orgId: string): Promise<number> {
    const [memberCount, pendingCount] = await Promise.all([
      this.prisma.orgMember.count({ where: { organizationId: orgId } }),
      this.prisma.orgInvitation.count({
        where: { organizationId: orgId, status: OrgInvitationStatus.PENDING, expiresAt: { gt: new Date() } },
      }),
    ]);
    return memberCount + pendingCount;
  }

  /** Lazily flips any PENDING invitation past its expiresAt to EXPIRED, for this org only — called before every read/write that depends on an accurate seat count. */
  private async expirePastDue(orgId: string): Promise<void> {
    await this.prisma.orgInvitation.updateMany({
      where: { organizationId: orgId, status: OrgInvitationStatus.PENDING, expiresAt: { lte: new Date() } },
      data: { status: OrgInvitationStatus.EXPIRED },
    });
  }

  /** IDOR guard, same pattern as ShortlistService.getOwnedEntry / JobsService.getOwnedJob — a memberId from another org can't be targeted through this org's endpoints. */
  private async getOwnedMember(orgId: string, memberId: string) {
    const member = await this.prisma.orgMember.findUnique({
      where: { id: memberId },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.organizationId !== orgId) throw new ForbiddenException();
    return member;
  }

  private async getOwnedInvitation(orgId: string, invitationId: string) {
    const invitation = await this.prisma.orgInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.organizationId !== orgId) throw new ForbiddenException();
    return invitation;
  }

  /**
   * An organization must always keep at least one EMPLOYER_ADMIN — remove
   * and demote both funnel through this before touching the target row, so
   * neither path can leave an org with zero admins (see this task's own
   * framing: that's the account-recovery path, not just a role nicety).
   */
  private async assertNotLastAdmin(orgId: string, target: { userId: string; user: { role: Role } }) {
    if (target.user.role !== Role.EMPLOYER_ADMIN) return;
    const adminCount = await this.prisma.orgMember.count({
      where: { organizationId: orgId, user: { role: Role.EMPLOYER_ADMIN } },
    });
    if (adminCount <= 1) {
      throw new ConflictException('An organization must always have at least one admin.');
    }
  }

  private async sendInviteEmail(email: string, orgName: string): Promise<void> {
    const link = `${WEB_BASE_URL}/employer-invite?email=${encodeURIComponent(email)}`;
    const subject = `You've been invited to join ${orgName} on MyAmbii`;
    const html = `
      <p>You've been invited to join <strong>${orgName}</strong> on MyAmbii as a team member.</p>
      <p><a href="${link}">Accept your invitation</a> and sign in with a verification code sent to this address.</p>
      <p>This invitation expires in 7 days.</p>
    `;
    try {
      await this.emailProvider.send({ to: email, subject, html });
    } catch (err) {
      this.logger.error(`Failed to send org invitation email: ${(err as Error).message}`);
      throw new BadRequestException('Could not send the invitation email. Please try again.');
    }
  }
}
