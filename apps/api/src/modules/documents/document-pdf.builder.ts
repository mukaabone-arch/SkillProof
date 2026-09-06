import PDFDocument from 'pdfkit';
import { DocumentSeries } from '@prisma/client';

/**
 * One taxable line item — a Document has one of these per covered
 * Transaction (see Document's own schema doc comment on the 2026-09
 * prepaid -> postpaid change: still exactly one for a SUBSCRIPTION_CHARGE
 * document, potentially many for an ASSESSMENT_REQUEST_ACCRUAL invoice).
 * basePaise here is that one Transaction's own taxable value; the
 * Document-level basePaise/gstPaise/etc. fields this builder also receives
 * are already the correct sum/total across every line item, computed once
 * by DocumentsService rather than re-derived here.
 */
export interface DocumentLineItem {
  description: string;
  basePaise: number;
}

/**
 * Everything the layout needs, already resolved to plain values — this
 * function takes a Document row (plus its line items) and has no I/O of
 * its own, same "pure layout, no I/O" contract as resume-pdf.builder.ts's
 * buildResumePdf. Field names match Document's own columns so a caller can
 * spread a Prisma row in directly.
 */
export interface DocumentPdfInput {
  series: DocumentSeries;
  documentNumber: string;
  issuedAt: Date;
  lineItems: DocumentLineItem[];

  sellerLegalName: string;
  sellerAddress: string;
  sellerGstin: string;
  sacCode: string;

  buyerLegalName: string | null;
  buyerGstin: string | null;
  buyerAddress: string | null;

  basePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  placeOfSupplyStateCode: string;
}

const INK = '#141b2d';
const INK_MUTED = '#5b6270';
const INDIGO = '#3240b8';

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/**
 * pdfkit, not Puppeteer — same choice and reasoning as
 * resume-pdf.builder.ts's own doc comment: this is a fixed single-page
 * form (header, seller/buyer block, one line item, a small tax table,
 * total), not a document that needs a CSS layout engine. A headless
 * Chromium in the API container would add hundreds of MB to the image and
 * meaningful per-render memory for no layout benefit here.
 *
 * TAX_INVOICE vs RECEIPT (see DocumentSeries's own doc comment) differ only
 * in title text and whether the buyer-GSTIN row renders — both are the
 * same document under Section 31 CGST, so this is one layout, not two.
 */
export function buildDocumentPdf(input: DocumentPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 56, right: 56 } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderHeader(doc, input);
    renderParties(doc, input);
    renderLineItem(doc, input);
    renderTotals(doc, input);
    renderFooter(doc);

    doc.end();
  });
}

function renderHeader(doc: PDFKit.PDFDocument, input: DocumentPdfInput) {
  const title = input.series === DocumentSeries.TAX_INVOICE ? 'TAX INVOICE' : 'RECEIPT';
  doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(20).text(title);
  doc.moveDown(0.3);
  doc.fillColor(INK).font('Helvetica').fontSize(10);
  doc.text(`Document number: ${input.documentNumber}`);
  doc.text(`Date: ${input.issuedAt.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`);
  doc.moveDown(0.6);
  ruler(doc);
  doc.moveDown(0.6);
}

function renderParties(doc: PDFKit.PDFDocument, input: DocumentPdfInput) {
  const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2 - 10;
  const top = doc.y;
  const leftX = doc.page.margins.left;
  const rightX = doc.page.margins.left + colWidth + 20;

  doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(9.5).text('FROM', leftX, top, { width: colWidth, characterSpacing: 0.5 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(input.sellerLegalName, leftX, doc.y + 2, { width: colWidth });
  doc.fillColor(INK_MUTED).font('Helvetica').fontSize(9).text(input.sellerAddress, { width: colWidth, lineGap: 1 });
  doc.text(`GSTIN: ${input.sellerGstin}`, { width: colWidth });
  doc.text(`SAC: ${input.sacCode}`, { width: colWidth });
  const leftBottom = doc.y;

  doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(9.5).text('BILLED TO', rightX, top, { width: colWidth, characterSpacing: 0.5 });
  if (input.buyerLegalName) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(input.buyerLegalName, rightX, doc.y + 2, { width: colWidth });
  } else {
    doc.fillColor(INK_MUTED).font('Helvetica-Oblique').fontSize(9.5).text('Not on file', rightX, doc.y + 2, { width: colWidth });
  }
  doc.fillColor(INK_MUTED).font('Helvetica').fontSize(9);
  if (input.buyerAddress) doc.text(input.buyerAddress, rightX, doc.y, { width: colWidth, lineGap: 1 });
  if (input.series === DocumentSeries.TAX_INVOICE && input.buyerGstin) {
    doc.text(`GSTIN: ${input.buyerGstin}`, rightX, doc.y, { width: colWidth });
  }
  doc.text(`Place of supply: ${input.placeOfSupplyStateCode}`, rightX, doc.y, { width: colWidth });
  const rightBottom = doc.y;

  doc.y = Math.max(leftBottom, rightBottom);
  doc.x = doc.page.margins.left;
  doc.moveDown(0.8);
  ruler(doc);
  doc.moveDown(0.6);
}

/** One row per line item — a plain per-item taxable-value list, no per-row tax split (each line item shares the one place of supply printed in the parties block, so cgst/sgst/igst is only ever shown once, in the totals). */
function renderLineItem(doc: PDFKit.PDFDocument, input: DocumentPdfInput) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const descWidth = width * 0.6;
  const amountWidth = width * 0.4;
  const x = doc.page.margins.left;

  doc.fillColor(INK_MUTED).font('Helvetica-Bold').fontSize(8.5).text('DESCRIPTION', x, doc.y, { width: descWidth, characterSpacing: 0.5 });
  doc.text('TAXABLE VALUE', x + descWidth, doc.y - doc.currentLineHeight(), { width: amountWidth, align: 'right', characterSpacing: 0.5 });
  doc.moveDown(0.3);
  ruler(doc);
  doc.moveDown(0.4);

  for (const item of input.lineItems) {
    const rowY = doc.y;
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(item.description, x, rowY, { width: descWidth });
    doc.text(rupees(item.basePaise), x + descWidth, rowY, { width: amountWidth, align: 'right' });
    doc.moveDown(0.5);
  }
  doc.moveDown(0.3);
  ruler(doc);
  doc.moveDown(0.5);
}

function renderTotals(doc: PDFKit.PDFDocument, input: DocumentPdfInput) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelWidth = width * 0.6;
  const amountWidth = width * 0.4;
  const x = doc.page.margins.left;

  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.fillColor(bold ? INK : INK_MUTED).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5);
    doc.text(label, x, y, { width: labelWidth });
    doc.text(value, x + labelWidth, y, { width: amountWidth, align: 'right' });
    doc.moveDown(0.35);
  };

  row('Taxable value', rupees(input.basePaise));
  if (input.cgstPaise > 0) row('CGST (9%)', rupees(input.cgstPaise));
  if (input.sgstPaise > 0) row('SGST (9%)', rupees(input.sgstPaise));
  if (input.igstPaise > 0) row('IGST (18%)', rupees(input.igstPaise));
  doc.moveDown(0.2);
  row('Total', rupees(input.totalPaise), true);
}

function renderFooter(doc: PDFKit.PDFDocument) {
  doc.moveDown(1);
  ruler(doc);
  doc.moveDown(0.4);
  doc
    .fillColor(INK_MUTED)
    .font('Helvetica-Oblique')
    .fontSize(8)
    .text('This is a digitally generated document and does not require a signature.', { align: 'center' });
}

function ruler(doc: PDFKit.PDFDocument) {
  const y = doc.y;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor('#d8dae0')
    .lineWidth(0.75)
    .stroke();
}
