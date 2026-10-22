/**
 * Line icons for the admin console sidebar — same stroke style and 24-unit
 * grid as NavGlyphs (candidate/employer), kept in their own file because
 * they name admin-only concepts (integrity blocks, GST documents, …).
 */
export type AdminGlyphName =
  | 'dashboard'
  | 'config'
  | 'sessionReview'
  | 'attemptReview'
  | 'integrity'
  | 'questions'
  | 'privacy'
  | 'exports'
  | 'verification'
  | 'candidates'
  | 'billingProfiles'
  | 'documents'
  | 'roadmap';

const PATHS: Record<AdminGlyphName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  config: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="7" cy="18" r="2" fill="currentColor" />
    </>
  ),
  sessionReview: (
    <>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" />
      <polyline points="9 12 11.5 14.5 15.5 10" />
    </>
  ),
  attemptReview: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <polyline points="9 13 11 15 15 11" />
    </>
  ),
  integrity: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <circle cx="12" cy="16" r="0.6" fill="currentColor" />
    </>
  ),
  questions: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </>
  ),
  privacy: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  exports: (
    <>
      <path d="M12 3v12" />
      <polyline points="7 10 12 15 17 10" />
      <path d="M5 19h14" />
    </>
  ),
  verification: (
    <>
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-5h6v5" />
      <polyline points="9 10.5 11 12.5 15 8.5" />
    </>
  ),
  candidates: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18 14.8c1.8.7 3 2.5 3.5 5.2" />
    </>
  ),
  billingProfiles: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </>
  ),
  documents: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </>
  ),
  roadmap: (
    <>
      <path d="M4 21V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </>
  ),
};

export default function AdminGlyph({ name }: { name: AdminGlyphName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
