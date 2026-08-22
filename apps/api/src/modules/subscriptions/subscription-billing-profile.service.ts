import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Auto-provisions a minimal BillingProfile the moment a candidate's first
 * Razorpay charge succeeds, so RazorpayWebhookService always has somewhere
 * to attach the resulting Transaction (billingProfileId is NOT NULL — see
 * that model's own doc comment). Deliberately bypasses
 * BillingProfilesService/CreateBillingProfileDto entirely: that path is the
 * admin-only, GST-invoicing-grade flow and still requires
 * legalEntityName/billingEmail/address in full (see that DTO) — a
 * candidate checking out for a ₹299/₹2,999 consumer subscription has never
 * been through that intake and shouldn't be blocked on it. Only fills in
 * what's already on file (fullName, email); every other now-nullable
 * column (see BillingProfile's own schema doc comment) is left for an
 * admin to complete later if this candidate ever needs a real GST invoice.
 * Never overwrites an existing profile — if one already exists (admin- or
 * previously auto-created), it's reused as-is.
 */
@Injectable()
export class SubscriptionBillingProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureMinimalBillingProfile(candidateId: string): Promise<string> {
    const existing = await this.prisma.billingProfile.findUnique({ where: { candidateId } });
    if (existing) return existing.id;

    const candidate = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      include: { user: { select: { email: true } } },
    });

    const created = await this.prisma.billingProfile.create({
      data: {
        candidateId,
        legalEntityName: candidate?.fullName ?? null,
        billingEmail: candidate?.user.email ?? null,
      },
    });
    return created.id;
  }
}
