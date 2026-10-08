import { AppError } from '../../platform/errors.js';

/** The `OUTCOME_` problems (R12, WP-21). */

export const outcomeNotAllowed = (detail: string): AppError =>
  new AppError({
    code: 'OUTCOME_NOT_ALLOWED',
    status: 409,
    title: 'No result yet',
    detail,
    retryable: false,
  });

export const outcomeNotFound = (): AppError =>
  new AppError({
    code: 'OUTCOME_NOT_FOUND',
    status: 404,
    title: 'No outcome',
    detail: 'This competition has no outcome recorded.',
    retryable: false,
  });

export const outcomeInvalid = (detail: string): AppError =>
  new AppError({
    code: 'OUTCOME_INVALID',
    status: 422,
    title: 'Check the outcome',
    detail,
    retryable: false,
  });

export const outcomeVersionConflict = (): AppError =>
  new AppError({
    code: 'OUTCOME_VERSION_CONFLICT',
    status: 409,
    title: 'Someone else changed this',
    detail: 'Someone else changed this — reload to see their change.',
    hint: 'Reload, then make your change again.',
    retryable: false,
  });
