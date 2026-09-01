import { DocumentSeries } from '@prisma/client';

/**
 * India's GST financial year: April 1 – March 31, formatted "2026-27" (Rule
 * 46(b)'s "unique for a financial year"). Computed from the SUPPLY date —
 * callers must pass Transaction.createdAt (when the charge actually
 * happened), never wall-clock "now" at generation time — see Document's own
 * issuedAt doc comment for why: a backfilled document for an old charge
 * must land in the FY that charge actually occurred in.
 */
export function financialYearFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed; 3 = April
  const startYear = month >= 3 ? year : year - 1;
  const endYearShort = (startYear + 1) % 100;
  return `${startYear}-${endYearShort.toString().padStart(2, '0')}`;
}

/**
 * The exact string printed on the document and shown to a customer — e.g.
 * "INV/2026-27/000001" or "RCT/2026-27/000001". Six-digit, zero-padded
 * sequence — plenty of headroom for a business this size; if a single
 * series ever needs more than 999,999 documents in one financial year,
 * widen this deliberately rather than silently truncating.
 */
export function formatDocumentNumber(series: DocumentSeries, financialYear: string, sequenceNumber: number): string {
  const prefix = series === DocumentSeries.TAX_INVOICE ? 'INV' : 'RCT';
  return `${prefix}/${financialYear}/${sequenceNumber.toString().padStart(6, '0')}`;
}
