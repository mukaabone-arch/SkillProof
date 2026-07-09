import { ReactNode } from 'react';
import Link from 'next/link';

export interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  actionHref?: string;
  children?: ReactNode;
}

/**
 * Consistent "nothing here yet" pattern — every empty list in the app (no
 * badges, no applications, no matches) should prompt the next action rather
 * than just show blank space.
 */
export function EmptyState({ message, actionLabel, actionHref, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p style={{ margin: 0 }}>{message}</p>
      {actionLabel && actionHref && (
        <div className="empty-state-action">
          <Link href={actionHref}>
            <button className="btn btn-primary">{actionLabel}</button>
          </Link>
        </div>
      )}
      {children}
    </div>
  );
}
