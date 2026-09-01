import { DocumentSeries } from '@prisma/client';
import { buildDocumentPdf, DocumentPdfInput } from './document-pdf.builder';

function baseInput(overrides: Partial<DocumentPdfInput> = {}): DocumentPdfInput {
  return {
    series: DocumentSeries.RECEIPT,
    documentNumber: 'RCT/2026-27/000001',
    issuedAt: new Date('2026-08-31T06:20:41.000Z'),
    description: 'MyAmbii Premium subscription charge',
    sellerLegalName: 'Mukaab Technologies Private Limited',
    sellerAddress: 'F/602, Mahavir Heritage, Sector 35 G, Kharghar, Navi Mumbai, 410210, Maharashtra',
    sellerGstin: '27AAUCM4131F1ZC',
    sacCode: '998313',
    buyerLegalName: 'Jordan Lee',
    buyerGstin: null,
    buyerAddress: null,
    basePaise: 29900,
    cgstPaise: 2691,
    sgstPaise: 2691,
    igstPaise: 0,
    totalPaise: 35282,
    placeOfSupplyStateCode: '27',
    ...overrides,
  };
}

describe('buildDocumentPdf', () => {
  it('renders a RECEIPT (no buyer GSTIN) into a non-empty PDF buffer without throwing', async () => {
    const buf = await buildDocumentPdf(baseInput());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a TAX_INVOICE (with buyer GSTIN/address) without throwing', async () => {
    const buf = await buildDocumentPdf(
      baseInput({
        series: DocumentSeries.TAX_INVOICE,
        documentNumber: 'INV/2026-27/000001',
        buyerGstin: '29AAACT2727Q1ZM',
        buyerAddress: '1st Floor, MG Road, Bengaluru, 560001, Karnataka',
        placeOfSupplyStateCode: '29',
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 5382,
      }),
    );
    expect(buf.length).toBeGreaterThan(0);
  });

  it('renders with no buyer name on file at all (auto-created candidate BillingProfile, common case)', async () => {
    const buf = await buildDocumentPdf(baseInput({ buyerLegalName: null }));
    expect(buf.length).toBeGreaterThan(0);
  });
});
