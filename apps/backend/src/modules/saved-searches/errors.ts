import { AppError } from '../../platform/errors.js';

/** `SAVED_SEARCH_` problems (R12, WP-24). Another person's search is "not found", never "forbidden". */

export const savedSearchNotFound = (): AppError =>
  new AppError({
    code: 'SAVED_SEARCH_NOT_FOUND',
    status: 404,
    title: 'No such saved search',
    detail: 'That saved search does not exist or is not yours.',
    retryable: false,
  });

export const savedSearchNameTaken = (name: string): AppError =>
  new AppError({
    code: 'SAVED_SEARCH_NAME_TAKEN',
    status: 409,
    title: 'You already have a search with that name',
    detail: `“${name}” is already one of your saved searches.`,
    hint: 'Choose another name, or update the existing search.',
    retryable: false,
  });

export const savedSearchVersionConflict = (): AppError =>
  new AppError({
    code: 'SAVED_SEARCH_VERSION_CONFLICT',
    status: 409,
    title: 'This saved search changed in another window',
    detail: 'Reload your saved searches and try again.',
    retryable: false,
  });
