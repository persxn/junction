import { AppError } from '../../platform/errors.js';

/** The `TRANSFER_` problems (R12, WP-21). */

export const transferPreviewStale = (): AppError =>
  new AppError({
    code: 'TRANSFER_PREVIEW_STALE',
    status: 409,
    title: 'Something changed since the preview',
    detail: 'Something changed since the preview — review it again.',
    retryable: false,
  });

export const transferTargetNotProfessor = (): AppError =>
  new AppError({
    code: 'TRANSFER_TARGET_NOT_PROFESSOR',
    status: 422,
    title: 'Pick an active professor',
    detail: 'Ownership can only move to an active account with the Professor role.',
    retryable: false,
  });

export const transferSameUser = (): AppError =>
  new AppError({
    code: 'TRANSFER_SAME_USER',
    status: 422,
    title: 'Pick two different people',
    detail: 'The professor giving up ownership and the one receiving it must differ.',
    retryable: false,
  });

export const transferNothingToMove = (): AppError =>
  new AppError({
    code: 'TRANSFER_NOTHING_TO_MOVE',
    status: 422,
    title: 'Nothing to move',
    detail: 'This professor has no active teams, open competitions or mentorships to move.',
    retryable: false,
  });

export const transferUserNotFound = (): AppError =>
  new AppError({
    code: 'TRANSFER_USER_NOT_FOUND',
    status: 404,
    title: 'No such account',
    detail: 'One of those accounts does not exist.',
    retryable: false,
  });
