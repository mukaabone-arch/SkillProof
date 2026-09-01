import { DocumentSeries } from '@prisma/client';
import { financialYearFor, formatDocumentNumber } from './document-numbering.util';

describe('financialYearFor', () => {
  it('April 1 starts a new financial year', () => {
    expect(financialYearFor(new Date('2026-04-01T00:00:00.000Z'))).toBe('2026-27');
  });

  it('March 31 (23:59:59) is still the tail of the previous financial year', () => {
    expect(financialYearFor(new Date('2027-03-31T23:59:59.999Z'))).toBe('2026-27');
  });

  it('a mid-year date (e.g. August) falls in the FY that started the preceding April', () => {
    expect(financialYearFor(new Date('2026-08-31T06:20:41.000Z'))).toBe('2026-27');
  });

  it('a January date falls in the FY that started the PREVIOUS calendar year, not the current one', () => {
    expect(financialYearFor(new Date('2027-01-15T00:00:00.000Z'))).toBe('2026-27');
  });

  it('formats the short end-year with a leading zero across a century-ish boundary (e.g. 2099-00 stays two digits)', () => {
    // Not a real near-term case, but locks the padStart behavior in rather
    // than leaving a silent "-100" if this code is ever still running then.
    expect(financialYearFor(new Date('2099-04-01T00:00:00.000Z'))).toBe('2099-00');
  });
});

describe('formatDocumentNumber', () => {
  it('formats a tax invoice with the INV prefix and a zero-padded sequence', () => {
    expect(formatDocumentNumber(DocumentSeries.TAX_INVOICE, '2026-27', 1)).toBe('INV/2026-27/000001');
  });

  it('formats a receipt with the RCT prefix', () => {
    expect(formatDocumentNumber(DocumentSeries.RECEIPT, '2026-27', 42)).toBe('RCT/2026-27/000042');
  });

  it('does not truncate a sequence number past six digits', () => {
    expect(formatDocumentNumber(DocumentSeries.RECEIPT, '2026-27', 1234567)).toBe('RCT/2026-27/1234567');
  });
});
