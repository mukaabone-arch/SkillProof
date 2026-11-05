'use client';

/**
 * Glassmorphism header for the marketing landing page (the domain root "/") ONLY —
 * deliberately NOT PublicNav or the app chrome. It's fixed over the hero
 * photo, translucent with a backdrop blur so the image shows through, and
 * grows more opaque on scroll so its links stay legible once it passes from
 * the bright hero onto the darker sections below. All of that is scoped to
 * `.lp-header` in globals.css.
 *
 * Nav: "Candidate" is a direct link (most traffic, one click); employers and
 * recruiters share a "For Business" disclosure menu, each with a one-line
 * description so the two business doors aren't confused. The menu opens on
 * click (works on touch), closes on Esc / outside click / picking an item.
 * Below the phone breakpoint the whole nav collapses into the ☰ menu; inside
 * it (.lp-nav.is-open) the business items are shown expanded, no second tap.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import BrandLockup from '@/components/BrandLockup';
import LocaleSwitcher from '@/components/LocaleSwitcher';

interface Props {
  /** Candidate sign-in target (see the landing page's own constant + report). */
  candidateHref: string;
  /** Employer sign-in target. */
  employerHref: string;
  /** Recruiter (staffing-company) sign-in target (/staffing). */
  staffingHref: string;
}

export default function LandingHeader({ candidateHref, employerHref, staffingHref }: Props) {
  const t = useTranslations('header');
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bizOpen, setBizOpen] = useState(false);
  const bizRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!bizOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (bizRef.current && !bizRef.current.contains(e.target as Node)) setBizOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBizOpen(false);
        bizRef.current?.querySelector<HTMLButtonElement>('.lp-biz-btn')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bizOpen]);

  const closeAll = () => {
    setBizOpen(false);
    setMenuOpen(false);
  };

  return (
    <header className={`lp-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="lp-header-inner">
        <BrandLockup variant="hero" href="/" ariaLabel={t('home')} onClick={closeAll} />

        <button
          type="button"
          className="lp-menu-btn"
          aria-expanded={menuOpen}
          aria-controls="lp-primary-nav"
          aria-label={menuOpen ? t('closeMenu') : t('openMenu')}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="lp-menu-icon" aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
        </button>

        <nav id="lp-primary-nav" className={`lp-nav${menuOpen ? ' is-open' : ''}`} aria-label={t('primaryNav')}>
          <a href={candidateHref} className="lp-nav-link lp-cand-link" onClick={closeAll}>
            <span className="lp-biz-icon lp-biz-icon-c" aria-hidden="true">C</span>
            <span>
              <span className="lp-biz-title">{t('candidate')}</span>
              <span className="lp-biz-desc lp-cand-desc">{t('candidateDesc')}</span>
            </span>
          </a>

          <div className="lp-biz" ref={bizRef}>
            <button
              type="button"
              className={`lp-biz-btn${bizOpen ? ' is-open' : ''}`}
              aria-expanded={bizOpen}
              aria-controls="lp-biz-menu"
              onClick={() => setBizOpen((v) => !v)}
            >
              {t('forBusiness')} <span className="lp-biz-chev" aria-hidden="true" />
            </button>
            <div id="lp-biz-menu" className={`lp-biz-menu${bizOpen ? ' is-open' : ''}`}>
              <p className="lp-biz-heading">{t('forBusiness')}</p>
              <a href={employerHref} className="lp-biz-item" onClick={closeAll}>
                <span className="lp-biz-icon lp-biz-icon-e" aria-hidden="true">E</span>
                <span>
                  <span className="lp-biz-title">{t('employer')}</span>
                  <span className="lp-biz-desc">{t('employerDesc')}</span>
                </span>
              </a>
              <a href={staffingHref} className="lp-biz-item" onClick={closeAll}>
                <span className="lp-biz-icon lp-biz-icon-r" aria-hidden="true">R</span>
                <span>
                  <span className="lp-biz-title">{t('recruiter')}</span>
                  <span className="lp-biz-desc">{t('recruiterDesc')}</span>
                </span>
              </a>
            </div>
          </div>
          <LocaleSwitcher className="lp-nav-link" />
        </nav>
      </div>
    </header>
  );
}
