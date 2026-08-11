'use client';

/**
 * Glassmorphism header for the marketing landing page (the domain root "/") ONLY —
 * deliberately NOT PublicNav or the app chrome. It's fixed over the hero
 * photo, translucent with a backdrop blur so the image shows through, and
 * grows more opaque on scroll so its links stay legible once it passes from
 * the bright hero onto the darker sections below. All of that is scoped to
 * `.lp-header` in globals.css — the codebase removed backdrop-blur from the
 * login card once it no longer sat over a busy background; here it genuinely
 * sits over a photo, so it earns its place, and it stays contained to this
 * one component.
 *
 * The brand lockup (Logo hero mark + "SkillProof" wordmark) is ~278px wide,
 * which together with the direct links doesn't fit a phone. Below a
 * breakpoint the links collapse into a toggled menu rather than wrapping or
 * shrinking the lockup.
 */
import { useEffect, useState } from 'react';
import Logo from '../Logo';

interface Props {
  /** Candidate sign-in target (see the landing page's own constant + report). */
  candidateHref: string;
  /** Employer sign-in target. */
  employerHref: string;
}

export default function LandingHeader({ candidateHref, employerHref }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`lp-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="lp-header-inner">
        <a href="#top" className="lp-brand" aria-label="SkillProof home" onClick={() => setMenuOpen(false)}>
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">SkillProof</span>
        </a>

        <button
          type="button"
          className="lp-menu-btn"
          aria-expanded={menuOpen}
          aria-controls="lp-primary-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="lp-menu-icon" aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
        </button>

        <nav id="lp-primary-nav" className={`lp-nav${menuOpen ? ' is-open' : ''}`} aria-label="Primary">
          <a href="/contact" className="lp-nav-link" onClick={() => setMenuOpen(false)}>
            Contact
          </a>
          <a href={candidateHref} className="lp-nav-link" onClick={() => setMenuOpen(false)}>
            Candidate
          </a>
          <a href={employerHref} className="lp-nav-link" onClick={() => setMenuOpen(false)}>
            Employer
          </a>
        </nav>
      </div>
    </header>
  );
}
