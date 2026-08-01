import { ReactNode } from 'react';

export interface ErrorStateProps {
  /** Usually a plain string; ReactNode so a message that needs an embedded <Link> (e.g. "log in first to view this job") doesn't have to fall back to a raw paragraph instead of this component. */
  message: ReactNode;
  onRetry?: () => void;
}

/** Consistent, actionable error pattern — matches the existing .error text color/size. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state">
      <p className="error" style={{ margin: 0 }}>{message}</p>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
