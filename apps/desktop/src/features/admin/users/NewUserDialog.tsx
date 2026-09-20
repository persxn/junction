import { ROLE_KEYS, type RoleKey } from '@compintel/contracts';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * Adding a colleague. There is no password field on purpose: the server picks
 * the first one, shows it once and makes the new user replace it (ruling R38),
 * so an administrator never chooses — or learns — anybody's real password.
 */

const ROLE_LABELS: Readonly<Record<RoleKey, string>> = {
  ADMINISTRATOR: 'Administrator — can manage accounts, sources and settings',
  PROFESSOR: 'Professor — can mentor teams and run competitions',
};

export interface NewUserDialogProps {
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (input: {
    email: string;
    displayName: string;
    roles: readonly RoleKey[];
  }) => void;
}

export function NewUserDialog({ busy, onCancel, onCreate }: NewUserDialogProps): React.JSX.Element {
  const titleId = useId();
  const emailId = useId();
  const nameId = useId();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roles, setRoles] = useState<readonly RoleKey[]>(['PROFESSOR']);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && displayName.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-line bg-surface-raised p-6 shadow-[var(--ci-shadow-popover)]"
      >
        <h2 id={titleId} className="text-md">
          Add a person
        </h2>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={emailId} className="font-medium">
            E-mail
          </label>
          <input
            id={emailId}
            type="email"
            value={email}
            autoComplete="off"
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            className="rounded-md border border-line bg-surface px-3 py-2 text-fg"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="font-medium">
            Name
          </label>
          <input
            id={nameId}
            type="text"
            value={displayName}
            autoComplete="off"
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            className="rounded-md border border-line bg-surface px-3 py-2 text-fg"
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 font-medium">Roles</legend>
          {ROLE_KEYS.map((role) => (
            <label key={role} className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={roles.includes(role)}
                onChange={(event) => {
                  setRoles((current) =>
                    event.target.checked
                      ? [...current, role]
                      : current.filter((held) => held !== role),
                  );
                }}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ci-color-accent)]"
              />
              <span className="text-sm">{ROLE_LABELS[role]}</span>
            </label>
          ))}
        </fieldset>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line bg-surface px-3 py-2 font-medium hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !valid || roles.length === 0}
            onClick={() => {
              onCreate({ email: email.trim(), displayName: displayName.trim(), roles });
            }}
            className="rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
