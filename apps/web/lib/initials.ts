/**
 * First letters of up to the first two words of a name, for a placeholder
 * avatar shown until a photo/logo is set (or if one fails to load).
 * Falls back to a generic "?" for a name that isn't known yet — this is a
 * display fallback, not an identity guess, so it never returns anything
 * fabricated from data the caller doesn't have.
 *
 * Previously duplicated inline in app/profile/page.tsx (the profile-photo
 * placeholder) — promoted here so OrgMark and AccountMenu read the exact
 * same rule rather than each defining their own.
 */
export function initialsFrom(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}
