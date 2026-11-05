import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/landing/LegalDocument';

export const metadata: Metadata = { title: 'Refund Policy · MyAmbii' };

/**
 * Real Refund Policy content, following the same LegalDocument rendering
 * approach as TermsPage/PrivacyPage. Transcribed from
 * refund-policy-content.md verbatim: no clause is reworded, condensed, or
 * corrected. "Contact page" in the Questions section is wired to this app's
 * real /contact route rather than left as dead prose — same treatment
 * TermsPage gives its own "this link" reference to /privacy.
 */
export default function RefundsPage() {
  return (
    <LegalDocument title="Refund Policy" lastUpdated="17 August 2026">
      <p>
        This policy describes when payments made on MyAmbii are refunded. It applies alongside our Terms of
        Service.
      </p>
      <p>MyAmbii is operated by Mukaab Technologies Private Ltd.</p>

      <h2>Assessment requests</h2>
      <p>
        An employer may pay to request that a candidate take a skill assessment. The candidate is not charged for
        this — the request is free to them.
      </p>
      <p>
        <strong>A requested assessment must be started within 5 days of payment.</strong>
      </p>
      <p>The payment is refunded automatically, in full, in either of these cases:</p>
      <ul>
        <li>
          <strong>The candidate does not start the assessment within 5 days.</strong> The request expires and the
          payment is returned.
        </li>
        <li>
          <strong>The candidate&apos;s account becomes unavailable</strong> — for example if they deactivate or
          delete their account — before the assessment is started.
        </li>
      </ul>
      <p>
        Refunds are identified by an automated sweep that runs every hour, so a refund is normally initiated within
        an hour of the request expiring or the candidate becoming unavailable. No action is required from the
        employer.
      </p>
      <p>
        <strong>Once a candidate has started a requested assessment, the payment is not refundable.</strong> The
        assessment has been delivered at that point, regardless of the result — a candidate who does not pass has
        still taken the assessment that was paid for.
      </p>

      <h2>How refunds are returned</h2>
      <p>
        Refunds are processed through Razorpay to the original payment method. Once initiated, the funds typically
        reach the account within 5 to 7 working days, depending on the bank or card issuer.
      </p>
      <p>We do not issue refunds by any other route, and we cannot refund to a different account from the one used for payment.</p>

      <h2>Subscriptions</h2>
      <p>
        Subscription payments are not refundable once a subscription is active. This includes any unused portion of
        a subscription period following a cancellation.
      </p>
      <p>Cancelling a subscription stops future billing; it does not refund amounts already paid.</p>

      <h2>Failed refunds</h2>
      <p>
        If a refund cannot be completed automatically — for example if the original payment method is no longer
        valid — the request is flagged for manual attention and our team will contact the payer to resolve it.
      </p>

      <h2>Questions</h2>
      <p>
        If you believe a refund is due and has not been received, contact us through the details on our{' '}
        <Link href="/contact">Contact page</Link>, quoting the payment reference. We will respond within 3 working
        days.
      </p>
    </LegalDocument>
  );
}
