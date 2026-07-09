'use client';

import { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/**
 * .btn-primary / .btn-secondary render identically to the pre-existing bare
 * `button` default and `.btn-ghost` — this doesn't change how any current
 * page looks, it's an explicit, typed API for new/migrated pages to use
 * instead of a bare `<button>` + a stray class.
 */
export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return <button className={cx('btn', `btn-${variant}`, className)} {...props} />;
}
