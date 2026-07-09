export interface ErrorStateProps {
  message: string;
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
