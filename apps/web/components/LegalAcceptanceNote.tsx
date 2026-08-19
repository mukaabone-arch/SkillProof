import Link from 'next/link';

/**
 * The quiet line that sits *beneath* the sign-in card on every account-
 * creation surface (candidate login, employer login, invite acceptance).
 *
 * Acceptance is passive by design — continuing past this line is the act,
 * there is no checkbox and no added friction (see the server side, which
 * records a TermsAcceptance on every creation path regardless). It states
 * the 18-or-over confirmation the DPDP Act makes load-bearing, and links the
 * two documents.
 *
 * The /terms and /privacy targets are real routes (placeholder pages for
 * now — no legal copy drafted yet), so these links never 404. Colour/size
 * are theme-aware via .auth-legal in globals.css: muted ink on the light
 * split panels, light ink on the .auth-gradient invite page.
 */
export default function LegalAcceptanceNote() {
  return (
    <p className="auth-legal">
      By continuing, you confirm you are 18 or over and agree to our{' '}
      <Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link> and <Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
    </p>
  );
}
