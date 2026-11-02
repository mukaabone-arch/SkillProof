import Link from 'next/link';

/**
 * Empty state for the recruiter list pages (Availability requests,
 * Submissions). A first-time recruiter lands on these with nothing in them;
 * "Nothing here yet." told them nothing about how anything gets here. Shows
 * the 3-step path into the page plus one link to where step 1 happens.
 * Only for a genuinely empty list — a filtered-empty tab gets a one-liner
 * in the page itself.
 */
interface Props {
  title: string;
  steps: string[];
  cta: { href: string; label: string };
}

export default function StaffingEmptyState({ title, steps, cta }: Props) {
  return (
    <div className="card staffing-empty">
      <h2 className="staffing-empty-title">{title}</h2>
      <ol className="staffing-empty-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="staffing-empty-num" aria-hidden="true">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <Link href={cta.href} className="staffing-empty-cta">{cta.label}</Link>
    </div>
  );
}
