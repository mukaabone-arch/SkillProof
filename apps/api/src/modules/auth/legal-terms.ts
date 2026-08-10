/**
 * Version identifiers for the Terms of Service and Privacy Policy in force
 * at signup, stamped onto every TermsAcceptance row.
 *
 * These are date-stamped constants, not rows in a document-management
 * system — there is no such system yet, and a constant is a fine stand-in.
 * What matters for an acceptance record is that it captures *which* version
 * a user agreed to: when a document is materially revised, bump the
 * corresponding constant here in the same change that ships the new public
 * document. Existing TermsAcceptance rows keep their original stamp, so each
 * one still evidences exactly what was in force when it was written.
 *
 * Two separate constants because the two documents can be revised
 * independently — a Privacy Policy change should not silently restamp
 * acceptances of an unchanged Terms of Service.
 *
 * NOTE: the public /terms and /privacy pages on the web app are currently
 * placeholders (no legal text drafted yet). Keep these versions in step
 * with whatever those pages actually say once real documents land.
 */
export const TERMS_VERSION = '2026-08-10';
export const PRIVACY_VERSION = '2026-08-10';
