import type { ReactNode } from 'react';

/**
 * Shared shell for the /terms and /privacy placeholder pages. Renders a
 * clear "placeholder — not yet drafted" notice plus the in-force version
 * stamp, so nobody mistakes these for the finished documents. Intentionally
 * plain: these get replaced wholesale once real legal copy exists.
 */
export default function LegalPlaceholder({
  title,
  version,
  children,
}: {
  title: string;
  version: string;
  children: ReactNode;
}) {
  return (
    <main className="legal-page">
      <h1>{title}</h1>
      <p className="legal-placeholder-badge">Placeholder · v{version}</p>
      <p>{children}</p>
    </main>
  );
}
