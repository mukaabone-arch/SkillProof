/**
 * Canonical form for comparing/storing User.email in the OAuth auto-link
 * path. Real-world providers (Gmail, Google Workspace, GitHub, Outlook) all
 * treat an address case-insensitively even though RFC 5321 technically
 * permits a case-sensitive local part — without this, "Jane@Example.com"
 * and "jane@example.com" are two different strings under Postgres's
 * case-sensitive default collation and default @unique index, so the same
 * real mailbox can end up owning two separate User rows instead of being
 * linked via multiple Identities. profiles.dto.ts already normalizes the
 * same way (via its @Transform) for manual profile edits — this is the
 * OAuth-side equivalent, so both paths agree on one canonical form.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
