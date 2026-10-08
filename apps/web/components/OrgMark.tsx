/**
 * Org identity mark: the logo if one is on file, initials on a tile
 * otherwise — never a broken `<img>`. Square-ish (vs. the circular
 * person-avatar convention in AccountMenu/app/profile/page.tsx) so an org
 * mark and an account avatar are never visually confused for one another
 * when they sit side by side, as they do in the employer topbar.
 *
 * Shared by the employer topbar (small, inline with the brand lockup) and
 * the Settings page (large, next to the upload control) — see
 * lib/useOrgLogo.ts for the fetch both sides share too. Settings used to
 * fall back to a blank tinted square with no initials; this replaces that
 * with the same fallback the topbar needs anyway, so "no logo" looks the
 * same everywhere instead of each screen inventing its own placeholder.
 */
import { initialsFrom } from '@/lib/initials';

interface Props {
  name: string;
  logoUrl: string | null;
  size?: number;
}

export default function OrgMark({ name, logoUrl, size = 32 }: Props) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--brand-100)',
        color: 'var(--brand-800)',
        fontWeight: 600,
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
    >
      {initialsFrom(name)}
    </div>
  );
}
