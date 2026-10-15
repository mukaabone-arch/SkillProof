'use client';

/**
 * Static value-prop pitch for the candidate login's split-layout visual
 * panel (OtpLogin.tsx) — replaces AuthMessageRotator there. One permanent
 * headline, one rendered badge specimen, three proof points; no rotation.
 * AuthMessageRotator itself is untouched and still renders on
 * EmployerOtpLogin.tsx — that's a separate page with its own messages and
 * its own (not yet made) decision about whether to move off the rotator.
 *
 * Two variants, not one element repositioned by CSS: `visual` sits inside
 * `.auth-split-visual` (the gradient column) and is the ≥1100px
 * experience — full treatment, specimen included, with its own scrim (see
 * `.auth-pitch-scrim` in globals.css) for the same reason
 * AuthMessageRotator carries its own: `.auth-split-visual`'s background
 * stays tuned for the full brand ramp, not for text contrast, so whatever
 * sits on top of it has to guarantee its own. `inline` sits inside
 * `.auth-split-panel`, in flow, above the sign-in card, and is what
 * renders below 1100px instead of nothing (see globals.css's own note on
 * `.auth-split-message-rotator`'s `display: none` below that breakpoint —
 * this component deliberately does not inherit that rule). It drops the
 * badge specimen rather than shrinking it: "hidden if there isn't room
 * for it," not a smaller version of the same thing.
 *
 * Both variants render the same headline/proof-point copy through shared
 * classes (`.auth-pitch-headline`, `.auth-pitch-points`) so there is one
 * source of truth for the words; only the wrapper and the specimen differ.
 * Only one variant is ever visible at a given viewport width (the other is
 * `display: none`, which removes it from the accessibility tree, not just
 * hides it visually — same pattern as `.lp-hero-title-lg`/`-sm` on the
 * landing page) — so despite both being `<h1>`s, only one is ever exposed
 * to assistive tech at once.
 */
import { skillLevelName } from '@/lib/skillLevels';

const HEADLINE = 'Prove your skills. Get matched to jobs that want them.';

/**
 * Each line answers one question a candidate silently has before signing
 * up. The third is the one that matters most: `visibleToEmployers`
 * defaults to false and the portfolio requires explicit candidate
 * approval before any of it reaches an employer (see
 * PortfolioService/CandidatePortfolio.approvedAt) — this is the one
 * un-scoped, universally true claim on this page, and it's the actual
 * objection (being measured in public), not price.
 */
const PROOF_POINTS = [
  'One skill, one level — Prompt Engineering, Practitioner — not a vague "AI skills" checkbox.',
  'Earned under assessment — never self-reported.',
  'Nothing reaches employers until you approve it — visibility is off by default.',
];

/**
 * Reuses the public badge-verification page's own treatment (`.cert` /
 * `.cert-mark` / `.cert-skill` in globals.css, see app/badges/[hash]) —
 * that markup is inline there too, not a shared component, so this is a
 * deliberate copy of the same classes rather than an extraction; if that
 * treatment changes, this needs updating too. A specimen, not a
 * credential: no candidate name, no issue/expiry dates, no verification
 * ID — the real page shows all three because it's proving one specific
 * person's claim; this is showing what the shape of a claim looks like,
 * and anything that read as resolvable would misrepresent it as real.
 * "Example badge" underneath says so explicitly rather than relying on
 * the reader to infer it from the missing fields.
 */
function BadgeSpecimen() {
  return (
    <div className="cert auth-pitch-specimen">
      <div className="cert-mark" aria-hidden="true">✓</div>
      <p className="cert-skill">Prompt Engineering — {skillLevelName('L2')}</p>
      <p className="auth-pitch-specimen-caption">Example badge</p>
    </div>
  );
}

function ProofPoints() {
  return (
    <ul className="auth-pitch-points">
      {PROOF_POINTS.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
  );
}

interface Props {
  variant: 'visual' | 'inline';
}

export default function AuthPitch({ variant }: Props) {
  if (variant === 'inline') {
    return (
      <div className="auth-pitch auth-pitch-inline">
        <h1 className="auth-pitch-headline">{HEADLINE}</h1>
        <ProofPoints />
      </div>
    );
  }

  return (
    <div className="auth-pitch auth-pitch-visual">
      <div className="auth-pitch-scrim" aria-hidden="true" />
      <div className="auth-pitch-content">
        <h1 className="auth-pitch-headline">{HEADLINE}</h1>
        <BadgeSpecimen />
        <ProofPoints />
      </div>
    </div>
  );
}
