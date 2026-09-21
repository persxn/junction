import { AppError } from '../../platform/errors.js';

/** The `EVENT_` problems the dedup review raises (R12, §7.5). */

export const eventNotFound = (id: string): AppError =>
  new AppError({
    code: 'EVENT_NOT_FOUND',
    status: 404,
    title: 'No such event',
    detail: `There is no event with the id "${id}".`,
    retryable: false,
  });

export const dedupCandidateNotFound = (id: string): AppError =>
  new AppError({
    code: 'EVENT_NOT_FOUND',
    status: 404,
    title: 'No such duplicate candidate',
    detail: `There is no possible-duplicate pair with the id "${id}".`,
    retryable: false,
  });

/** §6.1: somebody changed it since you loaded it. */
export const eventVersionConflict = (what: string, expected: number, actual: number): AppError =>
  new AppError({
    code: 'EVENT_VERSION_CONFLICT',
    status: 409,
    title: 'This was changed by someone else',
    detail: `${what} is at version ${String(actual)}, not ${String(expected)}.`,
    hint: 'Reload it and decide again.',
    retryable: false,
  });

export const eventCandidateDecided = (status: string): AppError =>
  new AppError({
    code: 'EVENT_CANDIDATE_DECIDED',
    status: 409,
    title: 'This pair has already been decided',
    detail: `The pair is ${status}; only a PENDING pair can be merged or rejected.`,
    retryable: false,
  });

export const eventAlreadyMerged = (id: string): AppError =>
  new AppError({
    code: 'EVENT_ALREADY_MERGED',
    status: 409,
    title: 'That event has already been merged',
    detail: `Event "${id}" is merged into another event. Unmerge it first.`,
    retryable: false,
  });

export const eventNotMerged = (id: string): AppError =>
  new AppError({
    code: 'EVENT_NOT_MERGED',
    status: 409,
    title: 'That event is not merged',
    detail: `Event "${id}" has not been merged into anything, so there is nothing to undo.`,
    retryable: false,
  });

export const eventMergeSelf = (): AppError =>
  new AppError({
    code: 'EVENT_MERGE_SELF',
    status: 409,
    title: 'An event cannot be merged into itself',
    detail: 'Both sides of the pair are the same event.',
    retryable: false,
  });
