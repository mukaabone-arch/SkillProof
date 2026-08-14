import Image from 'next/image';
import Link from 'next/link';

/**
 * Shared MyAmbii mark + wordmark, covering every lockup variant found across
 * the app: nav/topbar (PublicNav, CandidateNav, EmployerSidebarShell,
 * AdminNav, AdminSidebarShell), hero/auth-card (OtpLogin, EmployerOtpLogin,
 * EmployerInviteAccept, OAuthCallback), and a plain link (LegalStub).
 *
 * variant picks the wrapper + mark CSS classes (see globals.css's "flair
 * future Intelligence branding" block): 'nav' renders `.appnav-logo` +
 * `.brand-logo` (wordmark hides below 640px, no wrap/shrink protection
 * needed — the nav row solves width pressure by hiding the wordmark
 * outright); suffix (Admin) renders inline after the wordmark, same as
 * before. 'hero' renders `.brand-lockup-hero` (+ `.brand-lockup-link` when
 * href is set, matching every hero consumer except OAuthCallback's
 * deliberately plain, non-linked lockup) + `.brand-logo-hero` — the
 * wordmark never hides; suffix (Employers) instead stacks on its own line
 * beneath the wordmark via `.brand-lockup-hero-text` (a column beside the
 * mark), so the row never has to accommodate "MyAmbii for Employers" on one
 * line — that width pressure is gone, which is also why the auth-card/
 * auth-split-card size override that used to compensate for it was removed
 * from globals.css.
 *
 * href omitted renders a plain, non-interactive wrapper (OAuthCallback's
 * transient mid-auth screen). ariaLabel is only passed where the link
 * target is genuinely "home" (`/`) — nav links to a dashboard/admin route
 * never carry one, matching every consumer surveyed.
 */
interface Props {
  variant: 'nav' | 'hero';
  href?: string;
  ariaLabel?: string;
  /** nav: "MyAmbii Admin" inline. hero: "MyAmbii" / "Employers" stacked.
   *  Omitted renders plain "MyAmbii". */
  suffix?: 'Admin' | 'Employers';
}

const MARK_SRC = '/Myambii-Logo-64px.png';

export default function BrandLockup({ variant, href, ariaLabel, suffix }: Props) {
  const wrapperClassName =
    variant === 'nav' ? 'appnav-logo' : `brand-lockup-hero${href ? ' brand-lockup-link' : ''}`;
  const markClassName = variant === 'nav' ? 'brand-logo' : 'brand-logo-hero';

  const content = (
    <>
      {/* flexShrink: 0 mirrors .brand-lockup-hero .brand-logo-hero in globals.css
          (see that rule's own comment — an SVG/img with no fixed intrinsic
          size shrinks below its nominal height under flex-wrap otherwise) —
          set inline so the guarantee holds for this mark regardless of which
          wrapper class ends up around it. */}
      <Image src={MARK_SRC} alt="" width={64} height={64} className={markClassName} style={{ flexShrink: 0 }} priority />
      {variant === 'nav' ? (
        <span className="brand-product-name">
          {suffix ? (
            <>
              MyAmbii <span style={{ color: 'var(--ink-60)', fontWeight: 500 }}>{suffix}</span>
            </>
          ) : (
            'MyAmbii'
          )}
        </span>
      ) : (
        <span className="brand-lockup-hero-text">
          <span className="brand-product-name">MyAmbii</span>
          {suffix && <span className="brand-lockup-hero-suffix">{suffix}</span>}
        </span>
      )}
    </>
  );

  if (!href) {
    return <div className={wrapperClassName}>{content}</div>;
  }

  return (
    <Link href={href} className={wrapperClassName} aria-label={ariaLabel}>
      {content}
    </Link>
  );
}
