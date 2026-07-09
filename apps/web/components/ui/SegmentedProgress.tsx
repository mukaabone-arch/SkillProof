export type SegmentedProgressState = 'done' | 'active' | 'upcoming';

export interface SegmentedProgressStep {
  label: string;
  subLabel: string;
  state: SegmentedProgressState;
}

export interface SegmentedProgressProps {
  steps: SegmentedProgressStep[];
}

/**
 * Labeled points along a horizontal bar — completed segments filled in
 * --brand-green, the current stage a prominent ringed dot, upcoming stages
 * muted grey (--ink-30/--ink-12). Generic over `steps`, not tied to any one
 * page's specific stages.
 */
export function SegmentedProgress({ steps }: SegmentedProgressProps) {
  return (
    <div className="segmented-progress">
      {steps.map((step, i) => (
        <div key={step.label} className={`segmented-progress-step ${step.state}`}>
          {i < steps.length - 1 && (
            <span className={`segmented-progress-track ${step.state === 'done' ? 'done' : ''}`} />
          )}
          <span className={`segmented-progress-dot ${step.state}`}>{step.state === 'done' ? '✓' : ''}</span>
          <div className="segmented-progress-label">{step.label}</div>
          <div className="segmented-progress-sublabel">{step.subLabel}</div>
        </div>
      ))}
    </div>
  );
}
