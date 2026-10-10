import { PASSWORD_MIN_LENGTH } from '@compintel/contracts';

import { useAuth } from './auth-context.js';
import { CredentialScreen } from './CredentialScreen.js';

/**
 * The three screens the auth state machine can put in front of the app.
 *
 * Each one is a thin call into `useAuth`; the rules are in the context and, in
 * the end, on the server — the lock screen in particular is cosmetic (R37), and
 * unlocking is a real password check, not a UI toggle.
 */

export function LoginScreen(): React.JSX.Element {
  const { signIn, busy, error } = useAuth();
  return (
    <CredentialScreen
      icon="sign-in"
      title="Sign in to Junction"
      description="Use the account an administrator created for you."
      fields={[
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'username' },
        {
          name: 'password',
          label: 'Password',
          type: 'password',
          autoComplete: 'current-password',
        },
      ]}
      submitLabel="Sign in"
      busy={busy}
      error={error}
      onSubmit={(values) => {
        void signIn(values.email ?? '', values.password ?? '');
      }}
    />
  );
}

export function LockScreen(): React.JSX.Element {
  const { unlock, signOut, busy, error, me } = useAuth();
  return (
    <CredentialScreen
      icon="lock"
      title="Junction is locked"
      description={`Enter the password for ${me?.user.email ?? 'this account'} to carry on. Scraping and reminders kept running.`}
      fields={[
        {
          name: 'password',
          label: 'Password',
          type: 'password',
          autoComplete: 'current-password',
        },
      ]}
      submitLabel="Unlock"
      busy={busy}
      error={error}
      onSubmit={(values) => {
        void unlock(values.password ?? '');
      }}
      secondaryAction={{
        label: 'Sign out instead',
        onAction: () => {
          void signOut();
        },
      }}
    />
  );
}

/** Ruling R38: nothing else in the app works until this is done. */
export function ChangePasswordScreen(): React.JSX.Element {
  const { changePassword, signOut, busy, error } = useAuth();
  return (
    <CredentialScreen
      icon="warning"
      title="Choose a new password"
      description="This account still has the password an administrator set for it. Pick your own before carrying on."
      fields={[
        {
          name: 'currentPassword',
          label: 'Current password',
          type: 'password',
          autoComplete: 'current-password',
        },
        {
          name: 'newPassword',
          label: 'New password',
          type: 'password',
          autoComplete: 'new-password',
          hint: `At least ${String(PASSWORD_MIN_LENGTH)} characters.`,
        },
      ]}
      submitLabel="Change password"
      busy={busy}
      error={error}
      onSubmit={(values) => {
        void changePassword(values.currentPassword ?? '', values.newPassword ?? '');
      }}
      secondaryAction={{
        label: 'Sign out instead',
        onAction: () => {
          void signOut();
        },
      }}
    />
  );
}
