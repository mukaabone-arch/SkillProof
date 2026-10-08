import { useEffect, useRef, useState } from 'react';
import { employerApi } from './api';

const { apiBlob } = employerApi;

/**
 * The org logo (GET /orgs/me/logo) is auth-gated, not a plain `<img src>`
 * URL, so every consumer fetches it as a blob and holds an object URL.
 * Shared by the employer topbar identity and the Settings page so both
 * handle "no logo on file" or a failed fetch identically: this returns
 * null in both cases, and null always means "show initials instead,"
 * never a broken `<img>`. See OrgMark.
 */
export function useOrgLogo(hasLogo: boolean): string | null {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setLogoUrl(null);
    if (!hasLogo) return;

    let cancelled = false;
    apiBlob('/orgs/me/logo')
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setLogoUrl(url);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [hasLogo]);

  // Unmount-only cleanup, separate from the effect above: that effect's own
  // cleanup only runs between re-fetches (on the next `hasLogo` change), so
  // without this the very last object URL created would never be revoked.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return logoUrl;
}
