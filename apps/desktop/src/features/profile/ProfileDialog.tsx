import { PASSWORD_MIN_LENGTH } from '@compintel/contracts';
import { useId, useState } from 'react';

import { useInstallation } from '../../app/installation.js';
import { useAuth } from '../../auth/auth-context.js';
import { Dialog } from '../../components/Dialog.js';
import { profileProblem } from './profile-model.js';

/**
 * "Create my profile" (WP-34, rulings R133 and R134).
 *
 * A guest can already do everything; a profile adds a name and a password lock.
 * On Myself the guest *becomes* the profile, so everything made so far stays.
 * On an institution's shared PC a new profile is made, and the guest's work goes
 * with it only if they say so — the guest is shared with every walk-in.
 */
export function ProfileDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const { createProfile, busy, error } = useAuth();
  const { isIndividual } = useInstallation();
  const ids = { name: useId(), email: useId(), password: useId(), again: useId() };
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [takeGuestData, setTakeGuestData] = useState(false);
  const problem = profileProblem({ displayName, email, password, again });

  const field = (
    id: string,
    label: string,
    value: string,
    set: (value: string) => void,
    type: 'text' | 'email' | 'password',
    autoComplete: string,
  ): React.JSX.Element => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => {
          set(event.target.value);
        }}
        className="rounded-md border border-line bg-surface px-3 py-2 text-fg"
      />
    </div>
  );

  return (
    <Dialog title="Create my profile" onClose={onClose}>
      <p className="text-fg-muted">
        {isIndividual
          ? 'Everything you have done as a guest stays yours. From now on Junction asks for this password when it opens.'
          : 'Your own profile on this computer, with a password. The guest stays for anyone else who sits down.'}
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (problem !== undefined || createProfile === undefined) return;
          void createProfile({
            displayName: displayName.trim(),
            email: email.trim(),
            password,
            takeGuestData: !isIndividual && takeGuestData,
          }).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        {field(ids.name, 'Your name', displayName, setDisplayName, 'text', 'name')}
        {field(ids.email, 'E-mail', email, setEmail, 'email', 'username')}
        {field(ids.password, 'Password', password, setPassword, 'password', 'new-password')}
        {field(ids.again, 'Password again', again, setAgain, 'password', 'new-password')}
        <p className="text-sm text-fg-subtle">
          At least {PASSWORD_MIN_LENGTH} characters. There is no e-mail reset, so keep it safe.
        </p>
        {!isIndividual && (
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={takeGuestData}
              onChange={(event) => {
                setTakeGuestData(event.target.checked);
              }}
              className="mt-0.5 size-4 shrink-0 accent-[var(--ci-color-accent)]"
            />
            <span className="text-sm">
              Take what Guest made with me — its teams, competitions, saved events and searches.
            </span>
          </label>
        )}
        {(error !== undefined || (problem !== undefined && password !== '')) && (
          <p role="alert" className="text-sm text-danger">
            {error?.detail ?? error?.title ?? problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-surface px-3 py-2 font-medium hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || problem !== undefined}
            className="rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create profile'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
