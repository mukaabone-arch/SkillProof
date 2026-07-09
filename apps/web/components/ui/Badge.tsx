import { HTMLAttributes } from 'react';
import { cx } from './cx';

export type BadgeVariant = 'default' | 'verified' | 'danger' | 'warning' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/** Small pill matching the .eyebrow / .chip visual language — status tags, skill chips, etc. */
export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return <span className={cx('ui-badge', `ui-badge-${variant}`, className)} {...props} />;
}
