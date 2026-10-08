import { AppError } from '../../platform/errors.js';

/** The `RESOURCE_` problems (R12, WP-20b). */

export const resourceNotFound = (): AppError =>
  new AppError({
    code: 'RESOURCE_NOT_FOUND',
    status: 404,
    title: 'No such resource',
    detail: 'That resource does not exist, or was removed.',
    retryable: false,
  });

export const resourceOwnerNotFound = (): AppError =>
  new AppError({
    code: 'RESOURCE_OWNER_NOT_FOUND',
    status: 404,
    title: 'Nothing to attach it to',
    detail: 'That competition, stage, task or outcome does not exist.',
    retryable: false,
  });

/** `detail` is the classifier's sentence ("Only web links (http or https) and paths…"). */
export const resourceInvalidUri = (detail: string): AppError =>
  new AppError({
    code: 'RESOURCE_INVALID_URI',
    status: 422,
    title: 'That link or path cannot be added',
    detail,
    retryable: false,
  });

export const resourceVersionConflict = (): AppError =>
  new AppError({
    code: 'RESOURCE_VERSION_CONFLICT',
    status: 409,
    title: 'Someone else changed this',
    detail: 'Someone else changed this — reload to see their change.',
    hint: 'Reload, then make your change again.',
    retryable: false,
  });
