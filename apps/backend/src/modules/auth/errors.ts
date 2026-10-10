import { AppError } from '../../platform/errors.js';

/**
 * The auth failures a client is allowed to be told apart (ruling R12's `AUTH_`
 * domain). They are separate codes because the UI has a different screen for
 * each: a wrong password is a retry, a lockout is a wait, a disabled account is
 * a conversation with an admin, and an expired session is the lock screen.
 *
 * None of them says whether the email exists. `AUTH_INVALID_CREDENTIALS` is the
 * answer for an unknown address and for a wrong password alike.
 */

export const invalidCredentials = (): AppError =>
  new AppError({
    code: 'AUTH_INVALID_CREDENTIALS',
    status: 401,
    title: 'That email address and password do not match',
    detail: 'Check the address and try again.',
    hint: 'An administrator can reset your password if you have forgotten it.',
    retryable: false,
  });

export const accountLocked = (unlocksAt: Date): AppError =>
  new AppError({
    code: 'AUTH_ACCOUNT_LOCKED',
    status: 401,
    title: 'This account is locked for a few minutes',
    detail: `Too many failed sign-ins. Try again after ${unlocksAt.toISOString()}.`,
    hint: 'Waiting is enough; the lock lifts by itself.',
    retryable: true,
  });

export const accountDisabled = (): AppError =>
  new AppError({
    code: 'AUTH_ACCOUNT_DISABLED',
    status: 401,
    title: 'This account has been disabled',
    detail: 'It can no longer be used to sign in.',
    hint: 'Ask an administrator to enable it again.',
    retryable: false,
  });

export const sessionExpired = (detail: string): AppError =>
  new AppError({
    code: 'AUTH_SESSION_EXPIRED',
    status: 401,
    title: 'Your session has ended',
    detail,
    hint: 'Sign in again to carry on.',
    retryable: false,
  });

/** Ruling R38: signed in, but nothing may be done until the password changes. */
export const passwordChangeRequired = (): AppError =>
  new AppError({
    code: 'AUTH_PASSWORD_CHANGE_REQUIRED',
    status: 403,
    title: 'Choose a new password before carrying on',
    detail: 'This account still has the password an administrator set for it.',
    retryable: false,
  });

/** Ruling R34's process-wide ceiling, independent of which account is targeted. */
export const tooManyAttempts = (): AppError =>
  new AppError({
    code: 'RATE_LIMITED',
    status: 429,
    title: 'Too many sign-in attempts',
    detail: 'Sign-in is limited across the whole application. Wait a moment and try again.',
    retryable: true,
  });

/** R132: the guest signs in with `POST /auth/guest`, never with a password. */
export const guestHasNoPassword = (): AppError =>
  new AppError({
    status: 403,
    code: 'AUTH_GUEST_HAS_NO_PASSWORD',
    title: 'The guest has no password',
    detail: 'Continue as guest instead, or create your own profile to use a password.',
    retryable: false,
  });

/** R132/R134: not a student install, the guest was claimed, or walk-in access is off. */
export const guestUnavailable = (): AppError =>
  new AppError({
    status: 404,
    code: 'AUTH_GUEST_UNAVAILABLE',
    title: 'Guest access is not available here',
    detail: 'Sign in with your profile instead.',
    retryable: false,
  });
