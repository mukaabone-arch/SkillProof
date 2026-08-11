'use client';

/**
 * Public contact form — its own route (/contact), not a section on the landing
 * page. Reasoning: it's a real multi-field form with its own success/failure
 * states and a Cancel that leaves the page, not a marketing blurb that belongs
 * in the single-scroll landing flow. A dedicated route keeps the landing page
 * uncluttered, gives the form a focused full-viewport layout, and lets Cancel
 * simply navigate home. The Contact links in the landing header and footer
 * point here (see components/landing/LandingHeader.tsx and app/page.tsx).
 *
 * Posts to the public POST /contact endpoint (ContactService) — no auth. All
 * validation is enforced server-side too; the browser bits here (required,
 * maxLength, the counter) are only convenience. The `company` field is a
 * honeypot: hidden from real users, dropped by the server if filled.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Logo from '@/components/Logo';

const DESCRIPTION_MAX = 2000;

/** Values must match apps/api ContactSubmissionDto / CONTACT_REASONS. */
const REASONS: { value: string; label: string }[] = [
  { value: 'general_enquiry', label: 'General enquiry' },
  { value: 'candidate_support', label: 'Candidate support' },
  { value: 'employer_enquiry', label: 'Employer enquiry' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'press', label: 'Press' },
  { value: 'other', label: 'Other' },
];

export default function ContactPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [company, setCompany] = useState(''); // honeypot

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const canSend =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    reason.length > 0 &&
    description.trim().length > 0 &&
    description.length <= DESCRIPTION_MAX &&
    !busy;

  async function send() {
    setError('');
    setBusy(true);
    try {
      await api('/contact', {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          reason,
          description: description.trim(),
          company, // honeypot — empty for real users
        }),
      });
      setSent(true);
    } catch (e) {
      const msg = (e as Error).message || '';
      // A total network failure surfaces as the browser's raw "Failed to
      // fetch"/"Load failed"; server-side errors (validation, 429, 502) come
      // through with a proper human message from the API — keep those as-is.
      const isNetwork = /failed to fetch|load failed|networkerror/i.test(msg);
      setError(
        isNetwork
          ? "We couldn't reach the server. Check your connection and try again."
          : msg || 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lp-page lp-contact-page" id="top">
      <div className="lp-container lp-contact-wrap">
        <Link href="/" className="lp-brand lp-contact-brand" aria-label="SkillProof home">
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">SkillProof</span>
        </Link>

        <div className="lp-contact-card">
          {sent ? (
            <div className="lp-contact-result" role="status" aria-live="polite">
              <div className="lp-contact-result-icon" aria-hidden="true">✓</div>
              <h1 className="lp-section-title" style={{ marginBottom: 8 }}>Message sent</h1>
              <p className="lp-prose-body">
                Thanks for reaching out — your message is on its way to our team. We&apos;ll reply to{' '}
                <strong>{email.trim()}</strong> as soon as we can.
              </p>
              <div className="lp-contact-actions">
                <Link className="lp-btn lp-btn-primary" href="/">Back to home</Link>
                <button
                  type="button"
                  className="lp-btn lp-btn-secondary"
                  onClick={() => {
                    setSent(false);
                    setFullName('');
                    setEmail('');
                    setReason('');
                    setDescription('');
                  }}
                >
                  Send another message
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="lp-section-eyebrow">Contact</p>
              <h1 className="lp-section-title" style={{ marginBottom: 8 }}>Get in touch</h1>
              <p className="lp-prose-body lp-contact-intro">
                Questions, support, partnerships or press — tell us what you need and we&apos;ll get back to you.
              </p>

              <form
                className="lp-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSend) send();
                }}
              >
                <div className="lp-field">
                  <label htmlFor="fullName">Full name</label>
                  <input
                    id="fullName"
                    type="text"
                    autoComplete="name"
                    maxLength={120}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                    required
                  />
                </div>

                <div className="lp-field">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>

                <div className="lp-field">
                  <label htmlFor="reason">Reason for contact</label>
                  <select
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select a reason…</option>
                    {REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                <div className="lp-field">
                  <div className="lp-field-labelrow">
                    <label htmlFor="description">Description</label>
                    <span
                      className={`lp-char-counter${description.length > DESCRIPTION_MAX ? ' is-over' : ''}`}
                      aria-live="polite"
                    >
                      {description.length} / {DESCRIPTION_MAX}
                    </span>
                  </div>
                  <textarea
                    id="description"
                    rows={6}
                    maxLength={DESCRIPTION_MAX}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="How can we help?"
                    required
                  />
                </div>

                {/* Honeypot: visually hidden and off the tab order; real users never fill it. */}
                <div className="lp-hp" aria-hidden="true">
                  <label htmlFor="company">Company (leave this blank)</label>
                  <input
                    id="company"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>

                {error && <p className="error lp-contact-error" role="alert">{error}</p>}

                <div className="lp-contact-actions">
                  <button type="submit" className="lp-btn lp-btn-primary" disabled={!canSend}>
                    {busy ? 'Sending…' : 'Send message'}
                  </button>
                  <button
                    type="button"
                    className="lp-btn lp-btn-secondary"
                    onClick={() => router.push('/')}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
