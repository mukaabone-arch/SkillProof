import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBillingProfileDto, UpdateBillingProfileDto } from './billing.dto';

/**
 * Admin CRUD for BillingProfile — legal/tax billing details attached to
 * either a CandidateProfile or an Organization, never both (see
 * BillingProfile's own schema doc comment: a raw CHECK constraint enforces
 * this at the DB level; the guards below are defense in depth so a bad
 * request 400s with a clear message rather than surfacing as a raw
 * Postgres constraint-violation error). Every write is admin-access-logged
 * — see logAdminAccess — same "audit trail is best-effort infrastructure,
 * never a gate on the actual action" posture as every other caller of
 * AdminAccessLog in this codebase.
 */
@Injectable()
export class BillingProfilesService {
  private readonly logger = new Logger(BillingProfilesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createForCandidate(adminUserId: string, candidateProfileId: string, dto: CreateBillingProfileDto) {
    const candidate = await this.prisma.candidateProfile.findUnique({ where: { id: candidateProfileId } });
    if (!candidate) throw new NotFoundException('Candidate profile not found');

    const profile = await this.create({ ...dto, candidateId: candidateProfileId });
    await this.logAdminAccess(adminUserId, 'CREATE_BILLING_PROFILE', profile.id, candidateProfileId, null);
    return profile;
  }

  async createForOrganization(adminUserId: string, organizationId: string, dto: CreateBillingProfileDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');

    const profile = await this.create({ ...dto, organizationId });
    await this.logAdminAccess(adminUserId, 'CREATE_BILLING_PROFILE', profile.id, null, organizationId);
    return profile;
  }

  async get(id: string) {
    const profile = await this.prisma.billingProfile.findUnique({ where: { id } });
    if (!profile || profile.deletedAt) throw new NotFoundException('Billing profile not found');
    return profile;
  }

  async update(adminUserId: string, id: string, dto: UpdateBillingProfileDto) {
    const existing = await this.get(id);

    const updated = await this.prisma.billingProfile.update({ where: { id }, data: dto });
    await this.logAdminAccess(adminUserId, 'UPDATE_BILLING_PROFILE', id, existing.candidateId, existing.organizationId);
    return updated;
  }

  /** Soft delete only — same nullable-timestamp convention as CandidateProfile.deletedAt. Transactions referencing this profile are untouched and remain queryable. */
  async softDelete(adminUserId: string, id: string) {
    const existing = await this.get(id);

    const deleted = await this.prisma.billingProfile.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.logAdminAccess(adminUserId, 'DELETE_BILLING_PROFILE', id, existing.candidateId, existing.organizationId);
    return deleted;
  }

  /**
   * Shared create path for both owner types — enforces "exactly one owner"
   * before ever reaching the DB's own CHECK constraint, so a bad request
   * gets a clear 400 rather than a raw Postgres error. Also translates the
   * unique-constraint violation (a second billing profile for the same
   * candidate/org) into a clear 409, same P2002-to-409 pattern used
   * elsewhere in this codebase (e.g. JobsService.create's code conflict).
   */
  private async create(data: Prisma.BillingProfileUncheckedCreateInput) {
    const hasCandidate = data.candidateId != null;
    const hasOrg = data.organizationId != null;
    if (hasCandidate === hasOrg) {
      throw new BadRequestException('A billing profile must belong to exactly one of a candidate or an organization.');
    }

    try {
      return await this.prisma.billingProfile.create({ data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This candidate or organization already has a billing profile.');
      }
      throw err;
    }
  }

  private async logAdminAccess(
    adminUserId: string,
    action: string,
    targetId: string,
    candidateProfileId: string | null,
    organizationId: string | null,
  ): Promise<void> {
    try {
      await this.prisma.adminAccessLog.create({
        data: { adminUserId, action, targetType: 'BillingProfile', targetId, candidateProfileId, organizationId },
      });
    } catch (err) {
      this.logger.error(`Failed to write AdminAccessLog for ${action}: ${(err as Error).message}`);
    }
  }
}
