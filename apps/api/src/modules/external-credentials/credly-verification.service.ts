import { Injectable, Logger } from '@nestjs/common';
import { CredentialIssuer, CredentialVerificationState, Prisma } from '@prisma/client';

const CREDLY_BADGE_URL_RE = /^https?:\/\/(?:www\.)?credly\.com\/badges\/([0-9a-fA-F-]{36})(?:[/?#].*)?$/;
const FETCH_TIMEOUT_MS = 8000;

interface CredlyAssertion {
  id?: string;
  badge?: string;
  issuedOn?: string;
  expires?: string;
}

interface CredlyBadgeClass {
  name?: string;
  issuer?: { name?: string };
}

export interface CredlyVerificationResult {
  /** false when credentialUrl isn't a recognizable Credly badge URL — no fetch was attempted. */
  supported: boolean;
  state: CredentialVerificationState;
  issuer: CredentialIssuer;
  name: string | null;
  externalId: string | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
  rawMetadata: Prisma.InputJsonValue | null;
}

const UNSUPPORTED_RESULT: CredlyVerificationResult = {
  supported: false,
  state: CredentialVerificationState.PENDING,
  issuer: CredentialIssuer.OTHER,
  name: null,
  externalId: null,
  issuedAt: null,
  expiresAt: null,
  rawMetadata: null,
};

/**
 * Verifies a Credly badge URL against Credly's public, unauthenticated Open
 * Badges v2 (OBI) endpoints. Credly doesn't issue API keys to individual
 * users and its official REST API is organization-scoped, so there is no
 * "clean" documented single-badge JSON endpoint — this was found by directly
 * probing a live public badge: the public page (credly.com/badges/<uuid>)
 * is a client-rendered SPA with no embedded JSON, but its assertion is
 * served unauthenticated at api.credly.com/v1/obi/v2/badge_assertions/<uuid>
 * (standard OBI v2 "hosted verification" — this is *why* it's public with no
 * key: OBI hosted verification requires the assertion be fetchable). That
 * assertion links to a badge_classes endpoint carrying name/issuer/
 * description. A private or nonexistent badge 404s cleanly on the assertion
 * endpoint, which is what "is public" ultimately reduces to here — Credly
 * doesn't expose a separate public/private flag, only fetchability.
 */
@Injectable()
export class CredlyVerificationService {
  private readonly logger = new Logger(CredlyVerificationService.name);

  async verify(credentialUrl: string): Promise<CredlyVerificationResult> {
    const match = credentialUrl.match(CREDLY_BADGE_URL_RE);
    if (!match) return UNSUPPORTED_RESULT;

    const badgeId = match[1];
    try {
      const assertion = await this.fetchJson<CredlyAssertion>(
        `https://api.credly.com/v1/obi/v2/badge_assertions/${badgeId}`,
      );
      if (!assertion) return this.failed(badgeId, 'Badge not found, or not public.');

      // assertion.badge is Credly's own response telling us where to fetch the
      // badge class — pinned to api.credly.com before we follow it, so a
      // compromised/unexpected upstream response can't steer this server-side
      // fetch at an arbitrary URL (SSRF).
      if (!assertion.badge?.startsWith('https://api.credly.com/')) {
        return this.failed(badgeId, 'Badge exists but its details could not be read.', { assertion });
      }

      const badgeClass = await this.fetchJson<CredlyBadgeClass>(assertion.badge);
      if (!badgeClass?.name) {
        return this.failed(badgeId, 'Badge exists but its details could not be read.', { assertion });
      }

      return {
        supported: true,
        state: CredentialVerificationState.VERIFIED,
        issuer: this.mapIssuer(badgeClass.issuer?.name),
        name: badgeClass.name,
        externalId: badgeId,
        issuedAt: assertion.issuedOn ? new Date(assertion.issuedOn) : null,
        expiresAt: assertion.expires ? new Date(assertion.expires) : null,
        rawMetadata: { assertion, badgeClass } as unknown as Prisma.InputJsonValue,
      };
    } catch (err) {
      this.logger.warn(`Credly verification failed for badge ${badgeId}: ${(err as Error).message}`);
      return this.failed(badgeId, 'Could not reach Credly to verify this badge.');
    }
  }

  private failed(badgeId: string, reason: string, extra?: Record<string, unknown>): CredlyVerificationResult {
    return {
      supported: true,
      state: CredentialVerificationState.FAILED,
      issuer: CredentialIssuer.OTHER,
      name: null,
      externalId: badgeId,
      issuedAt: null,
      expiresAt: null,
      rawMetadata: { reason, ...extra } as unknown as Prisma.InputJsonValue,
    };
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  /**
   * Credly badges span countless issuing orgs; only a handful get a first-class
   * enum value (per the schema design). Anything else verified via Credly is
   * tagged CREDLY rather than OTHER, since we *did* successfully verify it —
   * OTHER is reserved for credentials we couldn't identify at all.
   */
  private mapIssuer(issuerName: string | undefined): CredentialIssuer {
    const n = (issuerName ?? '').toLowerCase();
    if (n.includes('amazon') || n.includes('aws')) return CredentialIssuer.AWS;
    if (n.includes('google')) return CredentialIssuer.GOOGLE;
    if (n.includes('microsoft') || n.includes('azure')) return CredentialIssuer.AZURE;
    if (n.includes('nvidia')) return CredentialIssuer.NVIDIA;
    if (n.includes('databricks')) return CredentialIssuer.DATABRICKS;
    if (n.includes('ibm')) return CredentialIssuer.IBM;
    return CredentialIssuer.CREDLY;
  }
}
