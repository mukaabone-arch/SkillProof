export interface LoadingStateProps {
  message?: string;
}

/** Consistent "working on it" pattern — a spinner + message instead of a frozen blank screen. */
export function LoadingState({ message = 'Loading…' }: LoadingStateProps) {
  return (
    <div className="loading-state">
      <span className="spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
