import { Lock, LogIn, ShieldAlert } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import type { ApiProblem } from '../api/problem.js';

export interface CredentialField {
  readonly name: string;
  readonly label: string;
  readonly type: 'email' | 'password';
  readonly autoComplete: string;
  readonly hint?: string;
}

export interface CredentialScreenProps {
  readonly icon?: 'sign-in' | 'lock' | 'warning';
  readonly title: string;
  readonly description: string;
  readonly fields: readonly CredentialField[];
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly error: ApiProblem | undefined;
  readonly onSubmit: (values: Record<string, string>) => void;
  /** An extra way out — "Sign out instead" on the lock screen. */
  readonly secondaryAction?: { readonly label: string; readonly onAction: () => void };
}

const ICONS = { 'sign-in': LogIn, lock: Lock, warning: ShieldAlert } as const;

/**
 * One form for the three credential screens — sign in, unlock, change password.
 *
 * They differ in wording and in which fields they ask for, and in nothing else,
 * so they share a component: three near-identical forms would drift, and the
 * accessible details (the label association, the error being announced, the
 * autocomplete hints a password manager needs) would drift with them.
 */
export function CredentialScreen({
  icon = 'sign-in',
  title,
  description,
  fields,
  submitLabel,
  busy,
  error,
  onSubmit,
  secondaryAction,
}: CredentialScreenProps): React.JSX.Element {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const Icon = ICONS[icon];

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    // A `main` rather than a `div`: these screens *are* the window — there is no
    // shell around them to provide the landmark, and without one every word on
    // them is content outside any landmark (M1 review fault 5's other half).
    <main className="flex h-full items-center justify-center bg-surface p-6">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-line bg-surface-raised p-6"
      >
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-5 text-accent" />
          <h1 className="text-lg">{title}</h1>
        </div>
        <p className="text-fg-muted">{description}</p>

        {error !== undefined && (
          <div
            role="alert"
            className="rounded-md border-l-4 border-danger bg-danger-surface p-3 text-danger"
          >
            <p className="font-medium">{error.title}</p>
            {error.detail !== undefined && <p className="text-sm">{error.detail}</p>}
            {error.hint !== undefined && <p className="text-sm">{error.hint}</p>}
          </div>
        )}

        {fields.map((field) => (
          <div key={field.name} className="flex flex-col gap-1">
            <label htmlFor={`${formId}-${field.name}`} className="font-medium">
              {field.label}
            </label>
            <input
              id={`${formId}-${field.name}`}
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              required
              value={values[field.name] ?? ''}
              onChange={(event) => {
                const next = event.target.value;
                setValues((current) => ({ ...current, [field.name]: next }));
              }}
              className="rounded-md border border-line bg-surface px-3 py-2 text-fg"
            />
            {field.hint !== undefined && <p className="text-sm text-fg-subtle">{field.hint}</p>}
          </div>
        ))}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? 'Working…' : submitLabel}
        </button>

        {secondaryAction !== undefined && (
          <button
            type="button"
            onClick={secondaryAction.onAction}
            className="text-sm text-accent underline"
          >
            {secondaryAction.label}
          </button>
        )}
      </form>
    </main>
  );
}
