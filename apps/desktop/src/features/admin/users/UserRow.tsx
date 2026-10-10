import type { RoleKey, UserSummary } from '@compintel/contracts';

import { useInstallation } from '../../../app/installation.js';

const ROLE_NAMES: Readonly<Record<RoleKey, string>> = {
  ADMINISTRATOR: 'Administrator',
  PROFESSOR: 'Professor',
  STUDENT: 'Student',
};
import { Check, KeyRound, Pencil, UserCheck, UserX, X } from 'lucide-react';
import { useState } from 'react';

/**
 * One account in the list, and its edit mode.
 *
 * Editing happens in place rather than in a dialog: the fields are a name and
 * two checkboxes, and a modal for that would be more ceremony than the change
 * deserves. The row carries the `version` it was loaded with, so a save that
 * lost a race comes back as a 409 the page can explain (§6.1).
 */

export interface UserRowProps {
  readonly user: UserSummary;
  readonly busy: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onSave: (displayName: string, roles: RoleKey[]) => void;
  readonly onReset: () => void;
}

function formatDate(iso: string | null): string {
  return iso === null ? 'Never' : new Date(iso).toLocaleDateString();
}

export function UserRow({
  user,
  busy,
  onToggle,
  onSave,
  onReset,
}: UserRowProps): React.JSX.Element {
  const { grantableRoles } = useInstallation();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [roles, setRoles] = useState<RoleKey[]>([...user.roles]);

  const disabled = user.status === 'DISABLED';

  return (
    <tr className="border-b border-line align-top">
      <td className="py-3">
        {editing ? (
          <input
            value={displayName}
            aria-label={`Name for ${user.email}`}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-fg"
          />
        ) : (
          <>
            <p className={disabled ? 'text-fg-muted line-through' : 'font-medium'}>
              {user.displayName}
            </p>
            <p className="text-sm text-fg-subtle">{user.email}</p>
          </>
        )}
      </td>

      <td className="py-3">
        {editing ? (
          <div className="flex flex-col gap-1">
            {grantableRoles.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
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
                  className="size-3.5 accent-[var(--ci-color-accent)]"
                />
                {ROLE_NAMES[role]}
              </label>
            ))}
          </div>
        ) : (
          <span className="text-sm text-fg-muted">
            {user.roles.length === 0
              ? '—'
              : user.roles
                  .map((role) => (role === 'ADMINISTRATOR' ? 'Admin' : 'Professor'))
                  .join(', ')}
          </span>
        )}
      </td>

      <td className="py-3 text-sm">
        <span className={disabled ? 'text-fg-subtle' : 'text-success'}>
          {disabled ? 'Disabled' : 'Active'}
        </span>
        {user.mustChangePassword && !disabled && (
          <span className="block text-fg-subtle">Must change password</span>
        )}
      </td>

      <td className="py-3 text-sm text-fg-muted">{formatDate(user.lastLoginAt)}</td>

      <td className="py-3">
        <div className="flex justify-end gap-1">
          {editing ? (
            <>
              <button
                type="button"
                disabled={busy || displayName.trim().length < 2 || roles.length === 0}
                onClick={() => {
                  onSave(displayName.trim(), roles);
                  setEditing(false);
                }}
                aria-label={`Save changes to ${user.email}`}
                className="flex items-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                <Check aria-hidden="true" className="size-3.5" />
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDisplayName(user.displayName);
                  setRoles([...user.roles]);
                  setEditing(false);
                }}
                aria-label={`Cancel editing ${user.email}`}
                className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-sm hover:bg-surface-hover"
              >
                <X aria-hidden="true" className="size-3.5" />
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(true);
                }}
                aria-label={`Edit ${user.email}`}
                className="rounded-md border border-line p-1.5 hover:bg-surface-hover disabled:opacity-50"
              >
                <Pencil aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onReset}
                aria-label={`Reset the password for ${user.email}`}
                className="rounded-md border border-line p-1.5 hover:bg-surface-hover disabled:opacity-50"
              >
                <KeyRound aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onToggle(disabled);
                }}
                aria-label={`${disabled ? 'Enable' : 'Disable'} ${user.email}`}
                className="rounded-md border border-line p-1.5 hover:bg-surface-hover disabled:opacity-50"
              >
                {disabled ? (
                  <UserCheck aria-hidden="true" className="size-3.5" />
                ) : (
                  <UserX aria-hidden="true" className="size-3.5 text-danger" />
                )}
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
