import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Auto-provisions a minimal BillingProfile the moment an org's first
 * assessment-request payment verifies, so AssessmentRequestsService always
 * has somewhere to attach the resulting Transaction (billingProfileId is
 * NOT NULL — see that model's own doc comment). Same posture as
 * SubscriptionBillingProfileService.ensureMinimalBillingProfile — bypasses
 * BillingProfilesService/CreateBillingProfileDto entirely, since that path
 * is the admin-only, GST-invoicing-grade flow requiring
 * legalEntityName/billingEmail/address in full, and an org paying for its
 * first assessment request has never been through that intake. Only fills
 * in what's already on file (Organization.name); every other now-nullable
 * column is left for an admin to complete later if this org ever needs a
 * real GST tax invoice (billingEmail/address/gstin — see BillingProfile's
 * own schema doc comment). Never overwrites an existing profile — if one
 * already exists (admin- or previously auto-created), it's reused as-is.
 */
@Injectable()
export class AssessmentRequestBillingProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureMinimalBillingProfile(organizationId: string): Promise<string> {
    const existing = await this.prisma.billingProfile.findUnique({ where: { organizationId } });
    if (existing) return existing.id;

    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });

    const created = await this.prisma.billingProfile.create({
      data: {
        organizationId,
        legalEntityName: org?.name ?? null,
      },
    });
    return created.id;
  }
}
