/**
 * Animated five-stage journey strip — the dashboard's footer flourish.
 * Verify skills → Earn badges → Match roles → Interview → Get hired, as a
 * horizontal rail a highlight travels along on a continuous CSS loop (see
 * the "journey feature strip" section of globals.css for the keyframes and
 * the prefers-reduced-motion static fallback).
 *
 * Purely decorative/presentational: no props, no state, no JS animation —
 * screen readers get the one visually-hidden summary sentence and the
 * animated rail is aria-hidden. Icons are inline single-color SVGs on
 * currentColor (no icon-font dependency), so the active/inactive color
 * states come entirely from the CSS around them.
 */

interface Stage {
  label: string;
  icon: React.ReactNode;
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const STAGES: Stage[] = [
  {
    label: 'Verify skills',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 3l7 3v5c0 4.4-3 8.4-7 9.5C8 19.4 5 15.4 5 11V6l7-3z" />
        <path d="M9 11.5l2 2 4-4.5" />
      </svg>
    ),
  },
  {
    label: 'Earn badges',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="9" r="5.5" />
        <path d="M9.5 13.5L8 21l4-2.2L16 21l-1.5-7.5" />
      </svg>
    ),
  },
  {
    label: 'Match roles',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="0.5" />
      </svg>
    ),
  },
  {
    label: 'Interview',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M20 11.5a7.5 7 0 0 1-7.5 7 8 8 0 0 1-3-.6L4 19.5l1.6-4A7 7 0 0 1 5 11.5a7.5 7 0 0 1 15 0z" />
      </svg>
    ),
  },
  {
    label: 'Get hired',
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
        <path d="M8.5 7.5v-2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2" />
        <path d="M3.5 12.5h17" />
      </svg>
    ),
  },
];

export default function FeatureStrip() {
  return (
    <section className="fstrip" aria-label="How SkillProof works">
      <p className="visually-hidden">
        Your SkillProof journey: verify your skills, earn badges, match with roles, interview, and get hired.
      </p>
      <div className="fstrip-rail" aria-hidden="true">
        <div className="fstrip-line">
          <i className="fstrip-line-fill" />
        </div>
        {STAGES.map((stage) => (
          <div key={stage.label} className="fstrip-stage">
            <span className="fstrip-node">{stage.icon}</span>
            <span className="fstrip-label">{stage.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
