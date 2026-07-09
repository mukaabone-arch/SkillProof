import { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds the --shadow-md elevation used by .model-card / .next-step-card / .status-card. */
  elevated?: boolean;
}

/**
 * Generic white/bordered/rounded surface matching the card language already
 * established by .card, .next-step-card, .status-card and .auth-card. Those
 * bespoke classes are untouched (each has its own layout needs — flex row,
 * link-card hover, etc.); this is the plain building block for new cards.
 */
export function Card({ elevated, className, ...props }: CardProps) {
  return <div className={cx('ui-card', elevated && 'ui-card-elevated', className)} {...props} />;
}
