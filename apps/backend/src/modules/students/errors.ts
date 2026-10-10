import {
  STUDENT_IMPORT_MAX_COLUMNS,
  STUDENT_IMPORT_MAX_FILE_BYTES,
  STUDENT_IMPORT_MAX_ROWS,
} from '@compintel/contracts';

import { AppError } from '../../platform/errors.js';

/**
 * The `STUDENT_` problems (R12, WP-17). None of them names a student: an error
 * reaches logs and screenshots, and R92 keeps names out of anything durable.
 */

export const studentNotFound = (): AppError =>
  new AppError({
    code: 'STUDENT_NOT_FOUND',
    status: 404,
    title: 'No such student',
    detail: 'That student does not exist, or was never part of this organization.',
    retryable: false,
  });

export const studentErased = (): AppError =>
  new AppError({
    code: 'STUDENT_ERASED',
    status: 409,
    title: 'This record was erased',
    detail:
      'An administrator erased this student’s personal details; the record can no longer be edited.',
    retryable: false,
  });

/** §6.1's optimistic concurrency, in the words the UI shows (WP-17 ground rules). */
export const studentVersionConflict = (): AppError =>
  new AppError({
    code: 'STUDENT_VERSION_CONFLICT',
    status: 409,
    title: 'Someone else changed this student',
    detail: 'Someone else changed this student — reload to see their changes.',
    hint: 'Reload the student, then make your change again.',
    retryable: false,
  });

export const universityIdTaken = (universityId: string): AppError =>
  new AppError({
    code: 'STUDENT_UNIVERSITY_ID_TAKEN',
    status: 409,
    title: 'That roll number is already in use',
    detail: `Another student already has the roll number ${universityId}.`,
    hint: 'Open that student instead, or check the number.',
    retryable: false,
  });

export const phoneDisabled = (): AppError =>
  new AppError({
    code: 'STUDENT_PHONE_DISABLED',
    status: 422,
    title: 'Phone numbers are not collected',
    detail: 'Junction is set not to store students’ phone numbers.',
    hint: 'An administrator can switch them on in Admin → Campus & settings.',
    retryable: false,
  });

export const externalDisabled = (): AppError =>
  new AppError({
    code: 'STUDENT_EXTERNAL_DISABLED',
    status: 422,
    title: 'Students from other institutions are switched off',
    detail: 'Junction is set to hold only this institution’s students.',
    hint: 'An administrator can allow them in Admin → Campus & settings.',
    retryable: false,
  });

export const alreadyMentored = (): AppError =>
  new AppError({
    code: 'STUDENT_ALREADY_MENTORED',
    status: 409,
    title: 'Already a mentor',
    detail: 'That professor already mentors this student.',
    retryable: false,
  });

export const mentorshipNotFound = (): AppError =>
  new AppError({
    code: 'STUDENT_MENTORSHIP_NOT_FOUND',
    status: 404,
    title: 'No such mentorship',
    detail: 'That mentorship does not exist or has already ended.',
    retryable: false,
  });

/** R93's 410 — also what another user's preview id gets is a 404 (see `previewNotFound`). */
export const previewExpired = (): AppError =>
  new AppError({
    code: 'STUDENT_IMPORT_PREVIEW_EXPIRED',
    status: 410,
    title: 'This preview has expired',
    detail: 'Import previews are kept for 30 minutes and are lost when Junction restarts.',
    hint: 'Choose the file again; nothing was imported.',
    retryable: false,
  });

/** Another user's preview id: as if it did not exist. */
export const previewNotFound = (): AppError =>
  new AppError({
    code: 'NOT_FOUND',
    status: 404,
    title: 'No such import preview',
    detail: 'There is no import preview with that id for your account.',
    retryable: false,
  });

export const importFileInvalid = (detail: string): AppError =>
  new AppError({
    code: 'STUDENT_IMPORT_FILE_INVALID',
    status: 422,
    title: 'That file could not be read',
    detail,
    hint: 'Save the sheet as .xlsx or .csv (UTF-8) and choose it again.',
    retryable: false,
  });

export const importTooLarge = (what: 'bytes' | 'rows' | 'columns'): AppError =>
  new AppError({
    code: 'STUDENT_IMPORT_TOO_LARGE',
    status: 413,
    title: 'That file is too large to import',
    detail:
      what === 'bytes'
        ? `The file is over ${String(STUDENT_IMPORT_MAX_FILE_BYTES / 1024)} KB.`
        : what === 'rows'
          ? `The sheet has more than ${String(STUDENT_IMPORT_MAX_ROWS)} students.`
          : `The sheet has more than ${String(STUDENT_IMPORT_MAX_COLUMNS)} columns.`,
    hint: 'Split it into smaller files and import them one after another.',
    retryable: false,
  });
