import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/landing/LegalDocument';

export const metadata: Metadata = {
  title: 'Delete your account · MyAmbii',
  description: 'How to delete your MyAmbii candidate account, and what happens to your information when you do.',
};

/**
 * Play Console's Data Safety form links here as the "Delete account URL" —
 * must be reachable with no sign-in, same requirement /privacy and /terms
 * already meet. Same rendering approach as those two and as RefundsPage:
 * transcribed from docs/legal/account-deletion-content.md verbatim, no
 * clause reworded.
 *
 * What's deleted/kept below is drawn from AccountService.delete, not
 * guessed — resume/photo/certification files really are removed from
 * storage (deleteStoredFiles), badges/applications are genuinely
 * anonymised in place rather than copied elsewhere, and the billing/tax
 * bullet is deliberately honest about BillingProfile having no purge
 * logic today rather than implying a retention period the code doesn't
 * enforce.
 */
export default function AccountDeletionPage() {
  return (
    <LegalDocument title="Delete your account" lastUpdated="2 October 2026">
      <p>
        MyAmbii is operated by <strong>Mukaab Technologies Private Limited</strong>. This page explains how to
        delete your MyAmbii candidate account and what happens to your information when you do.
      </p>

      <h2>Delete from the app or the website</h2>
      <ol>
        <li>Sign in to the MyAmbii app, or to www.myambii.com</li>
        <li>
          Go to <strong>Profile → Account</strong>
        </li>
        <li>
          Choose <strong>Delete account</strong> and confirm
        </li>
      </ol>
      <p>
        Your account is closed immediately. You will be signed out and will not be able to sign in again with the
        same phone number or email address.
      </p>

      <h2>If you cannot sign in</h2>
      <p>
        Email <strong>privacy@myambii.com</strong> from the email address on your account, or include the phone
        number you signed up with, and ask us to delete your account. We will verify that the request comes from
        the account holder before acting on it, and complete the deletion within 30 days.
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Your name, email address and phone number</li>
        <li>
          Your profile — headline, location, skills, work experience, education and any other details you entered
        </li>
        <li>Your profile photo</li>
        <li>Your uploaded resume</li>
        <li>Your connected Google and GitHub sign-in links</li>
        <li>
          The identifying details on any certification you added — its name, issuer, credential ID or link, and
          the uploaded file itself (see below for what stays)
        </li>
      </ul>
      <p>
        After deletion, nothing in your account identifies you, and your profile cannot be found by any employer on
        MyAmbii.
      </p>

      <h2>What is kept, and why</h2>
      <p>
        Some records are kept, with your identifying details removed — they are no longer linked to your name,
        contact details or profile, and cannot be used to identify or contact you.
      </p>
      <ul>
        <li>
          <strong>Assessment attempts, scores and badges.</strong> An employer who saw a verified badge during
          hiring relies on it being a real record. Keeping the result without the person attached preserves the
          integrity of the verification without keeping you identifiable.
        </li>
        <li>
          <strong>Certifications.</strong> The uploaded file is deleted and your name is removed, but a record
          that you held a verified certification — issuer, status, dates, skill — stays, for the same reason as a
          badge above.
        </li>
        <li>
          <strong>Applications you submitted.</strong> Employer records that already exist because you applied,
          were shortlisted, or interviewed are kept, anonymised — deleting your account doesn&apos;t create gaps in
          another organisation&apos;s hiring history. Your name and contact details are removed from them.
        </li>
        <li>
          <strong>A record that the deletion happened</strong>, with its date. This is the evidence that we acted
          on your request.
        </li>
        <li>
          <strong>Billing and tax records.</strong> If you have ever made a payment to us, we keep the billing
          details you provided — name, email address, phone number, billing address, and GSTIN where you gave one —
          along with the invoice and payment records. Indian tax law requires invoice and tax records to be
          retained. We do not currently delete these after a fixed period.
        </li>
      </ul>

      <h2>Timing</h2>
      <p>
                Deletion from the app takes effect immediately. Emailed requests are 
        completed within 30 days. Backups are
                kept on a rolling 7-day cycle, so a copy of your information may persist in 
        a backup for up to 7 days after
                deletion before it is overwritten.
      </p>

      <h2>Questions</h2>
      <p>privacy@myambii.com</p>
      <p>
        Mukaab Technologies Private Limited
        <br />
        Mumbai, Maharashtra, India
      </p>
      <p>
        See also our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalDocument>
  );
}
