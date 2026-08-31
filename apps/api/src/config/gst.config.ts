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
 * KNOWN GAP, FLAGGED DELIBERATELY — not fixed here, out of scope for the
 * change that introduced GST on subscriptions (see that change's own
 * notes): AssessmentRequest (employer-triggered, pay-per-assessment,
 * currently a flat ₹150/₹500-class charge via
 * AssessmentRequestsService.initiate) is equally a taxable supply and
 * currently carries no GST at all — no split, no inclusive pricing,
 * nothing. Shipping GST on subscriptions while assessment requests stay
 * untaxed is an inconsistency in MyAmbii's own GST position, not just a
 * missing feature, and needs closing before either goes live for real.
 * Whoever picks this up should reuse splitGst/these constants exactly the
 * same way this file's own callers do — do not write a second tax
 * calculation.
 */
