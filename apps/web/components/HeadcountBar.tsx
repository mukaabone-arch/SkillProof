/**
 * Hired / in progress / still open against a headcount, for a project or one
 * role. Hired is capped at the headcount for the bar (an over-hired role
 * shows a full bar); the words show the real numbers.
 */
interface Props {
  headcount: number;
  hired: number;
  inProgress: number;
  /** Compact: the numbers only on one line, for table cells. */
  compact?: boolean;
}

export default function HeadcountBar({ headcount, hired, inProgress, compact = false }: Props) {
  const total = Math.max(headcount, 1);
  const hiredShown = Math.min(hired, headcount);
  const progressShown = Math.min(inProgress, Math.max(headcount - hiredShown, 0));
  const pct = (n: number) => `${(n / total) * 100}%`;
  const label = `${hired} of ${headcount} hired${inProgress ? `, ${inProgress} in progress` : ''}`;
  return (
    <div className={`headcount${compact ? ' headcount-compact' : ''}`}>
      <div className="headcount-bar" role="img" aria-label={label}>
        <span className="headcount-hired" style={{ width: pct(hiredShown) }} />
        <span className="headcount-progress" style={{ width: pct(progressShown) }} />
      </div>
      <div className="headcount-words">
        <strong>
          {hired} of {headcount} hired
        </strong>
        {inProgress > 0 && <span> · {inProgress} in progress</span>}
      </div>
    </div>
  );
}
