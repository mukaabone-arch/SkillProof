'use client';

/**
 * Floating panel on the landing page hero ("/") and the candidate login
 * ("/candidate"). Each mount site owns where it sits (`.lp-hero-inner >
 * .beta-promo-scroll`, `.auth-split-panel > .beta-promo-scroll` in
 * globals.css). The name is historical: it used to carry the beta
 * "free until" offer.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getToken } from '@/lib/api';

/**
 * Mobile app availability (2026-11): "Available now on iOS and Android" with
 * the App Store and Google Play badges, replacing the text links. The
 * badges are cropped from the supplied artwork (public/badges/*.png, shown
 * at their native 1x size). Shown to signed-out visitors only, and no longer
 * tied to the beta offer window (the apps stay available after it ends).
 */
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.flairfuture.myambii';
const APP_STORE_URL = 'https://apps.apple.com/in/app/myambii/id6826762205';

export default function BetaPromoScroll() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(!getToken()), [pathname]);

  if (!visible) return null;

  return (
    <div className="beta-promo-scroll app-availability" role="note">
      <p className="app-availability-title">Available now on iOS and Android</p>
      <div className="app-availability-badges">
        <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/badges/app-store.png" width={211} height={61} alt="Download on the App Store" />
        </a>
        <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/badges/google-play.png" width={210} height={61} alt="Get it on Google Play" />
        </a>
      </div>
    </div>
  );
}
