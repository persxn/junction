import { PASSWORD_MIN_LENGTH } from '@compintel/contracts';

/**
 * The rules of the "Create my profile" form, kept out of the component (WP-34).
 * Answers the first thing wrong, in the order the fields are filled in, or
 * `undefined` when the form may be sent.
 */
export interface ProfileForm {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
  readonly again: string;
}

export function profileProblem(form: ProfileForm): string | undefined {
  if (form.displayName.trim().length < 2) return 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Enter an e-mail address.';
  if (form.password.length < PASSWORD_MIN_LENGTH) {
    return `The password needs at least ${String(PASSWORD_MIN_LENGTH)} characters.`;
  }
  if (form.password !== form.again) return 'The two passwords are different.';
  return undefined;
}
