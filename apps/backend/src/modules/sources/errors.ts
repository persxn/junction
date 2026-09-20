import { AppError } from '../../platform/errors.js';

/** The `SOURCE_` problems this module raises (R12, §7.7). */

export const sourceNotFound = (key: string): AppError =>
  new AppError({
    code: 'SOURCE_NOT_FOUND',
    status: 404,
    title: 'No such source',
    detail: `There is no source with the key "${key}".`,
    retryable: false,
  });

/**
 * The gate said no. One code for all three reasons — not approved, switched
 * off, outside `allowed_paths_json` — because §7.7 gives them one message
 * between them and an administrator needs the `Details` link, not a taxonomy.
 */
export const sourceBlockedByPolicy = (detail: string): AppError =>
  new AppError({
    code: 'SOURCE_BLOCKED_BY_POLICY',
    status: 409,
    title: 'This source is not scraped',
    detail,
    hint: 'A compliance verdict changes only after somebody has read the source’s Terms.',
    retryable: false,
  });

/** A10/R44: the wizard has not left an address to identify our requests with. */
export const sourceSetupIncomplete = (): AppError =>
  new AppError({
    code: 'SOURCE_SETUP_INCOMPLETE',
    status: 409,
    title: 'Setup is not finished',
    detail:
      'No source is contacted until the setup wizard has recorded a contact e-mail address, which every request identifies itself with.',
    hint: 'Finish the setup wizard, then try again.',
    retryable: false,
  });

/** D-27's manual floor. A 429 because it is a rate limit, and it will pass. */
export const sourceRefreshTooSoon = (key: string, allowedAt: Date): AppError =>
  new AppError({
    code: 'SOURCE_REFRESH_TOO_SOON',
    status: 429,
    title: 'That source was just refreshed',
    detail: `${key} has a minimum interval between manual refreshes; the next one is allowed at ${allowedAt.toISOString()}.`,
    hint: 'Wait for the next scheduled run, or try again later.',
    retryable: true,
  });
