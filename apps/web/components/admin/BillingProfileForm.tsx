'use client';

/**
 * The full CreateBillingProfileDto/UpdateBillingProfileDto field set —
 * shared by the create flow (app/admin/billing/page.tsx) and the edit flow
 * (app/admin/billing/profiles/[id]/page.tsx) rather than duplicated twice,
 * since it's the same ten fields with the same validation either way. Form
 * state is all strings (empty = unset); toPayload() below is the one place
 * that trims and drops empties, so both callers send an identical shape to
 * the API.
 */
import { useState } from 'react';

/** Same regex as apps/api's GSTIN_PATTERN (billing.dto.ts) — kept in sync by hand, not imported, since apps/web and apps/api don't share a package. */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export interface BillingProfileFormValues {
  legalEntityName: string;
  billingEmail: string;
  billingPhone: string;
  gstin: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  gstStateCode: string;
  postalCode: string;
  country: string;
}

export const EMPTY_BILLING_PROFILE_FORM: BillingProfileFormValues = {
  legalEntityName: '',
  billingEmail: '',
  billingPhone: '',
  gstin: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  gstStateCode: '',
  postalCode: '',
  country: 'IN',
};

/** Trims every field and drops empties to undefined — the shape both CreateBillingProfileDto and UpdateBillingProfileDto expect (optional fields simply absent, not empty strings). */
export function billingProfileFormToPayload(form: BillingProfileFormValues): Record<string, string | undefined> {
  const entries = Object.entries(form).map(([k, v]) => [k, v.trim() || undefined] as const);
  return Object.fromEntries(entries);
}

interface Props {
  values: BillingProfileFormValues;
  onChange: (values: BillingProfileFormValues) => void;
  /** Required-field markers only — the API is the real source of truth for what's mandatory; this is just so an admin isn't surprised by a 400. */
  requireCore?: boolean;
}

export default function BillingProfileForm({ values, onChange, requireCore }: Props) {
  const [gstinTouched, setGstinTouched] = useState(false);
  const gstinInvalid = gstinTouched && values.gstin.trim() !== '' && !GSTIN_PATTERN.test(values.gstin.trim());

  function set<K extends keyof BillingProfileFormValues>(key: K, value: string) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field">
        <label htmlFor="legalEntityName">Legal entity name{requireCore && ' *'}</label>
        <input id="legalEntityName" value={values.legalEntityName} onChange={(e) => set('legalEntityName', e.target.value)} maxLength={200} />
      </div>

      <div className="row" style={{ margin: 0 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="billingEmail">Billing email{requireCore && ' *'}</label>
          <input id="billingEmail" type="email" value={values.billingEmail} onChange={(e) => set('billingEmail', e.target.value)} maxLength={255} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="billingPhone">Billing phone</label>
          <input id="billingPhone" value={values.billingPhone} onChange={(e) => set('billingPhone', e.target.value)} placeholder="+91…" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="gstin">GSTIN</label>
        <input
          id="gstin"
          value={values.gstin}
          onChange={(e) => set('gstin', e.target.value.toUpperCase())}
          onBlur={() => setGstinTouched(true)}
          maxLength={15}
          style={{ textTransform: 'uppercase' }}
        />
        {gstinInvalid && <p className="field-error">Not a valid 15-character GSTIN (e.g. 27AAAAA0000A1Z5).</p>}
      </div>

      <div className="field">
        <label htmlFor="addressLine1">Address line 1{requireCore && ' *'}</label>
        <input id="addressLine1" value={values.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} maxLength={255} />
      </div>
      <div className="field">
        <label htmlFor="addressLine2">Address line 2</label>
        <input id="addressLine2" value={values.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} maxLength={255} />
      </div>

      <div className="row" style={{ margin: 0 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="city">City{requireCore && ' *'}</label>
          <input id="city" value={values.city} onChange={(e) => set('city', e.target.value)} maxLength={120} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="state">State{requireCore && ' *'}</label>
          <input id="state" value={values.state} onChange={(e) => set('state', e.target.value)} maxLength={120} />
        </div>
      </div>

      <div className="row" style={{ margin: 0 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="gstStateCode">GST state code</label>
          <input
            id="gstStateCode"
            value={values.gstStateCode}
            onChange={(e) => set('gstStateCode', e.target.value.toUpperCase())}
            maxLength={2}
            placeholder="e.g. 27"
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="postalCode">Postal code{requireCore && ' *'}</label>
          <input id="postalCode" value={values.postalCode} onChange={(e) => set('postalCode', e.target.value)} maxLength={20} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="country">Country</label>
          <input
            id="country"
            value={values.country}
            onChange={(e) => set('country', e.target.value.toUpperCase())}
            maxLength={2}
            placeholder="IN"
          />
        </div>
      </div>
    </div>
  );
}

export function isGstinValid(gstin: string): boolean {
  return gstin.trim() === '' || GSTIN_PATTERN.test(gstin.trim());
}
