import { splitGst, REGISTERED_STATE_CODE, DEFAULT_PLACE_OF_SUPPLY_STATE_CODE, GST_RATE } from './gst.config';

describe('splitGst', () => {
  it('matches the exact monthly pricing table: base ₹299.00, GST ₹53.82, total ₹352.82, CGST 9% + SGST 9% intra-state', () => {
    const result = splitGst(29900, '27');
    expect(result).toEqual({
      basePaise: 29900,
      gstPaise: 5382,
      totalPaise: 35282,
      cgstPaise: 2691,
      sgstPaise: 2691,
      igstPaise: 0,
      placeOfSupplyStateCode: '27',
    });
  });

  it('matches the exact annual pricing table: base ₹2,999.00, GST ₹539.82, total ₹3,538.82', () => {
    const result = splitGst(299900, '27');
    expect(result).toEqual({
      basePaise: 299900,
      gstPaise: 53982,
      totalPaise: 353882,
      cgstPaise: 26991,
      sgstPaise: 26991,
      igstPaise: 0,
      placeOfSupplyStateCode: '27',
    });
  });

  it('charges the exact same total regardless of the CGST/SGST vs IGST split — Razorpay only ever sees one number', () => {
    const intraState = splitGst(29900, '27');
    const interState = splitGst(29900, '29');
    expect(intraState.totalPaise).toBe(interState.totalPaise);
    expect(intraState.gstPaise).toBe(interState.gstPaise);
  });

  it('inter-state (a non-Maharashtra place of supply): full 18% as IGST, no CGST/SGST', () => {
    const result = splitGst(29900, '29'); // Karnataka
    expect(result).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 5382 });
  });

  it('basePaise + gstPaise always equals totalPaise exactly — never independently rounded', () => {
    for (const base of [29900, 299900, 1, 99, 12345, 1000000]) {
      const result = splitGst(base, '27');
      expect(result.basePaise + result.gstPaise).toBe(result.totalPaise);
    }
  });

  it('cgstPaise + sgstPaise always equals gstPaise exactly for an intra-state split, even when gstPaise is odd', () => {
    // 101 * 18 / 100 = 18.18 -> rounds to 18, an even split; pick a base
    // that actually produces an odd gstPaise to exercise the documented
    // "odd leftover paise goes to CGST" rule.
    const oddGstBase = 105; // 105*18/100 = 18.9 -> round = 19 (odd)
    const result = splitGst(oddGstBase, '27');
    expect(result.gstPaise).toBe(19);
    expect(result.cgstPaise + result.sgstPaise).toBe(result.gstPaise);
    // The documented rule: the odd paise goes to CGST, not SGST.
    expect(result.cgstPaise).toBe(10);
    expect(result.sgstPaise).toBe(9);
  });

  it('the registered-state and default-place-of-supply constants both resolve to Maharashtra (27) today', () => {
    expect(REGISTERED_STATE_CODE).toBe('27');
    expect(DEFAULT_PLACE_OF_SUPPLY_STATE_CODE).toBe('27');
  });

  it('GST_RATE is 18%', () => {
    expect(GST_RATE).toBe(0.18);
  });

  it('computes gstPaise as round(basePaise * 18 / 100) via integer math, for a range of odd/uneven inputs', () => {
    for (const base of [33333, 7, 1050505, 999999]) {
      const result = splitGst(base, '27');
      expect(Number.isInteger(result.gstPaise)).toBe(true);
      expect(result.gstPaise).toBe(Math.round((base * 18) / 100));
    }
  });
});
