'use client';

/**
 * "N of M left this month" meter, shown near the action it gates (Apply,
 * Start assessment) — the whole point is the candidate sees this *before*
 * hitting the wall, not after. Renders nothing when limit is null
 * (unlimited — Premium's assessmentsPerMonth/applicationsPerMonth), per
 * spec: an unlimited plan shows no meter at all, not a meter that never
 * fills. At zero remaining, the tone shifts to --warning rather than
 * --error — the intent is "you've used your plan's allowance, right on
 * schedule" (anticipated), not "something went wrong."
 */
interface UsageMeterProps {
  /** Plural noun describing what's counted, e.g. "applications", "assessment starts". */
  label: string;
  used: number;
  limit: number | null;
  /** ISO string. */
  resetsAt: string;
}

export function UsageMeter({ label, used, limit, resetsAt }: UsageMeterProps) {
  if (limit === null) return null;

  const remaining = Math.max(0, limit - used);
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  const resetDate = new Date(resetsAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  return (
    <div className="usage-meter">
      <div
        className="usage-meter-label"
        style={remaining === 0 ? { color: 'var(--warning)' } : undefined}
      >
        {remaining} of {limit} {label} left this month
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${pct}%`, background: remaining === 0 ? 'var(--warning)' : undefined }}
        />
      </div>
      <div className="meta" style={{ marginTop: 0 }}>Resets {resetDate}</div>
    </div>
  );
}
