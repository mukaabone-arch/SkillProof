/**
 * India GST — business registration details and the tax-split math, in one
 * place so nothing else in this codebase computes tax independently
 * (plans.config.ts's SUBSCRIPTION_PRICING stores base amounts only; every
 * consumer — the /plans response, the checkout breakdown,
 * RazorpayWebhookService.recordCharge — calls splitGst below rather than
 * multiplying by 1.18 itself).
 *
 * Registered as a regular (non-composition) taxpayer in Maharashtra. These
 * three constants are the actual GST registration on file — changing them
 * without also updating the real GSTIN registration would misstate every
 * transaction recorded from that point on.
 */
export const GSTIN = '27AAUCM4131F1ZC';
/** 2-digit GST state code MyAmbii is registered in — the seller's own place of business, used to decide CGST+SGST (intra-state) vs IGST (inter-state) against a customer's place of supply. */
export const REGISTERED_STATE_CODE = '27';
export const REGISTERED_STATE_NAME = 'Maharashtra';
export const GST_RATE = 0.18;

/**
 * Printed on every GST tax invoice/receipt (see the `documents` module) —
 * the actual registered legal entity and address on file, not a display
 * name. Source: docs/legal/refund-policy-content.md ("MyAmbii is operated
 * by Mukaab Technologies Private Ltd.") plus the registered address
 * supplied directly for this purpose. Changing either without updating the
 * real GST/company registration would misstate every document issued from
 * that point on — same caution as the GSTIN/state constants above.
 */
export const SELLER_LEGAL_NAME = 'Mukaab Technologies Private Limited';
export const SELLER_ADDRESS = 'F/602, Mahavir Heritage, Sector 35 G, Kharghar, Navi Mumbai, 410210, Maharashtra';

/**
 * Accounting Services Code for MyAmbii's taxable supply (subscriptions and
 * assessment requests alike — one business, one service classification).
 * Printed on every GST document (Rule 46 requires it). A single SAC code
 * covering both revenue flows is a deliberate simplification, not an
 * oversight — if the two are ever classified differently for tax purposes,
 * this becomes two constants and Document.sacCode already snapshots
 * per-row, so no historical document would need to change.
 *
 * Changed from 998313 to 9985 (tax consultant advice, 2026-09-01) — this
 * constant is only read at Document creation (DocumentsService.
 * reserveAndCreate snapshots it into Document.sacCode once, at numbering
 * time); every Document row created before this change keeps 998313
 * permanently in its own sacCode column, and any of those already rendered
 * to PDF have it baked into the stored file in S3. Neither is altered by
 * changing this constant — see the backfill/handling discussion wherever
 * this change was decided.
 */
export const SAC_CODE = '9985';

/**
 * SNAPSHOT PROPERTY — GSTIN, SELLER_LEGAL_NAME, SELLER_ADDRESS, and SAC_CODE
 * above are read from this file exactly ONCE per document, in
 * DocumentsService.reserveAndCreate, at numbering time — never again after
 * that. renderAndStore builds the PDF from document.sellerGstin/
 * sellerLegalName/sellerAddress/sacCode (the frozen Document columns), not
 * from these live constants, and nothing else in the codebase (no admin
 * action, no web screen — the only place any of this is ever displayed is
 * that one PDF) re-reads them for an existing Document either.
 *
 * This is deliberate and must be preserved: a GST document is legally
 * meant to reflect the seller's registration details as they stood at the
 * time of supply, so editing any of these four constants must only affect
 * Documents created after the edit, never silently rewrite what an
 * already-issued document says. If a future change (e.g. a "regenerate
 * PDF from current config" admin action) would read these constants live
 * for an existing Document instead of its own stored snapshot, that's the
 * moment this needs a real historical-values mechanism (e.g. an
 * effective-dated config table), not just a call added into the current
 * render path. Flagging this now, not building it — as of 2026-09-01
 * (the 998313 -> 9985 SAC change) zero documents had been generated, so
 * there was nothing to reconcile and no gap to close yet.
 */

/**
 * E-INVOICING (IRN/IRP) THRESHOLD — NOT YET APPLICABLE, RECHECK ON GROWTH.
 * E-invoicing (generating an IRN via a GST-approved Invoice Registration
 * Portal before a B2B tax invoice is valid) is mandatory only above this
 * aggregate turnover, computed across any financial year since 2017-18,
 * and only for B2B/export supplies — never B2C. Nothing in this codebase
 * tracks aggregate turnover, so nothing here will ever detect the
 * threshold being crossed automatically; whoever reviews financials
 * periodically needs to check this by hand. The threshold has been
 * lowered repeatedly since e-invoicing was introduced (₹500cr in 2020 down
 * to ₹5cr by 2023) — if turnover ever approaches it, this needs closing
 * before the `documents` module's TAX_INVOICE series can keep shipping
 * without an IRP call added first, and this comment should be updated
 * with the date it stopped being true.
 */
export const E_INVOICE_TURNOVER_THRESHOLD_PAISE = 5_00_00_000_00; // ₹5 crore

/**
 * Place of supply is collected after the first charge, not at checkout
 * (BillingProfile.gstStateCode stays null until an admin fills it in — see
 * SubscriptionBillingProfileService.ensureMinimalBillingProfile, which only
 * ever sets legalEntityName/billingEmail). Defaulting an unknown customer
 * to the registered state is the permitted B2C-digital-services fallback
 * (Section 12(2)(b), IGST Act) — deliberately the SAME value as
 * REGISTERED_STATE_CODE today, but kept as its own named constant rather
 * than reusing that one directly: they answer two different questions
 * ("where is MyAmbii registered" vs "what do we assume about a customer we
 * know nothing about yet"), and a future change to one must not silently
 * drag the other along just because they happen to collide right now.
 */
export const DEFAULT_PLACE_OF_SUPPLY_STATE_CODE = REGISTERED_STATE_CODE;

export interface GstSplit {
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  placeOfSupplyStateCode: string;
}

/**
 * The only function in this codebase allowed to compute GST. Two rounding
 * rules, chosen once and documented here so neither is ever "discovered"
 * later against a filed return:
 *
 *  1. gstPaise = round(basePaise * 18 / 100), computed as integer
 *     multiply-then-divide (never `basePaise * GST_RATE` — 0.18 has no
 *     exact binary floating-point representation, so that multiplication
 *     can land a hair off an integer paise value before rounding even
 *     runs). totalPaise is ALWAYS basePaise + gstPaise, never computed
 *     independently — this is what guarantees the two numbers displayed
 *     separately (base, GST) always sum to exactly the total charged, with
 *     no possibility of a one-paise discrepancy between "352.82 shown" and
 *     "352.81 + 0.01 stored".
 *  2. Intra-state (placeOfSupplyStateCode === REGISTERED_STATE_CODE): the
 *     18% splits evenly into 9%+9% for every amount this product actually
 *     charges today (both ₹299 and ₹2,999 base amounts divide evenly), but
 *     the rule for when they one day don't: cgstPaise = ceil(gstPaise / 2),
 *     sgstPaise = gstPaise - cgstPaise. Any odd leftover paise goes to
 *     CGST, arbitrarily but consistently — pick CGST because it's listed
 *     first in every one of this file's own type/copy, nothing deeper.
 *     Never change this rule for a period that's already been filed.
 */
export function splitGst(basePaise: number, placeOfSupplyStateCode: string): GstSplit {
  const gstPaise = Math.round((basePaise * 18) / 100);
  const totalPaise = basePaise + gstPaise;

  const isIntraState = placeOfSupplyStateCode === REGISTERED_STATE_CODE;
  const cgstPaise = isIntraState ? Math.ceil(gstPaise / 2) : 0;
  const sgstPaise = isIntraState ? gstPaise - cgstPaise : 0;
  const igstPaise = isIntraState ? 0 : gstPaise;

  return { basePaise, gstPaise, totalPaise, cgstPaise, sgstPaise, igstPaise, placeOfSupplyStateCode };
}

/**
 * CLOSED — AssessmentRequest (employer-triggered, pay-per-assessment) now
 * charges GST the same way subscriptions do: ₹150 base, splitGst'd via
 * this same function, ₹177 actually charged. See
 * AssessmentRequestsService.initiate/verifyAndCreate. This comment
 * previously flagged that gap; kept as a record that the inconsistency
 * was real and was deliberately closed, not just quietly patched — the two
 * revenue flows must never diverge in their GST treatment again without a
 * conscious decision.
 */
