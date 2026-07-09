import { InputHTMLAttributes } from 'react';
import { cx } from './cx';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Field-level validation message — distinct from the page-level .error banner. */
  error?: string;
}

/** Label + input + error, matching the .field pattern already used on the profile/admin pages. */
export function Field({ label, error, id, className, ...inputProps }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={cx(error && 'field-input-error', className)} {...inputProps} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
