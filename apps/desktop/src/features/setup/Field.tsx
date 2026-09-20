import { useId } from 'react';

/**
 * One labelled input, with its hint and its error wired up for a screen reader
 * (§16.3). Every field in the wizard goes through this, so the accessible
 * plumbing is written once and cannot be forgotten on step seven.
 */

export interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'email' | 'password' | 'number';
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly autoComplete?: string;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly readOnly?: boolean;
  /** Reserves the error line, so typing does not shift the layout. */
  readonly reserveErrorSpace?: boolean;
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error,
  autoComplete,
  placeholder,
  autoFocus = false,
  readOnly = false,
  reserveErrorSpace = true,
}: FieldProps): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value_): value_ is string => value_ !== undefined)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        readOnly={readOnly}
        // The first field of a wizard step is where the keyboard belongs:
        // nothing else on the screen has focus, and the alternative is a Tab
        // before every single answer.
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={
          'rounded-md border bg-surface px-3 py-2 text-fg transition-colors ' +
          'duration-[var(--ci-motion-fast)] placeholder:text-fg-subtle ' +
          'read-only:bg-surface-sunken read-only:text-fg-muted ' +
          (error === undefined ? 'border-line focus:border-accent' : 'border-danger')
        }
      />
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-fg-subtle">
          {hint}
        </p>
      )}
      {error !== undefined ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : (
        reserveErrorSpace && <p aria-hidden="true" className="h-0" />
      )}
    </div>
  );
}
