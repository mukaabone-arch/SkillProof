'use client';

/**
 * Employer-side candidate avatar: fetches a candidate's photo through the
 * authenticated GET /profiles/:id/photo proxy (never a public URL — see
 * ProfilesService.assertCanViewPhoto's employer branch) and falls back to
 * initials on no-photo/403/404. Mirrors app/profile/page.tsx's own
 * loadPhoto()/initials(), employer-scoped via employerApi.
 */
import { useEffect, useRef, useState } from 'react';
import { employerApi } from '@/lib/api';

const { apiBlob } = employerApi;

/** First letters of up to the first two words of a name, for the placeholder shown until a photo loads (or if it never will). */
function initials(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

interface Props {
  profileId: string;
  fullName: string | null;
  hasPhoto: boolean;
  size?: number;
}

export default function CandidateAvatar({ profileId, fullName, hasPhoto, size = 48 }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  // Tracks the currently-displayed blob: URL so it can be revoked before
  // creating the next one (or on unmount) without needing `url` itself as
  // an effect dependency.
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setUrl(null);

    if (!hasPhoto) return;

    apiBlob(`/profiles/${profileId}/photo`)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
      })
      // No relationship to this candidate yet, or the photo was removed
      // between listing and rendering — initials fallback covers both.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [profileId, hasPhoto]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--brand-100)',
        color: 'var(--brand-800)',
        fontSize: Math.round(size * 0.33),
        fontWeight: 600,
      }}
    >
      {initials(fullName)}
    </div>
  );
}
