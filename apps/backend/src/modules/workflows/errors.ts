import { AppError } from '../../platform/errors.js';

/** The `WORKFLOW_` problems (R12, WP-20a). */

export const workflowNotFound = (): AppError =>
  new AppError({
    code: 'WORKFLOW_NOT_FOUND',
    status: 404,
    title: 'No workflow yet',
    detail: 'This competition has no workflow. One is copied in when it is assigned.',
    retryable: false,
  });

export const stageNotFound = (): AppError =>
  new AppError({
    code: 'WORKFLOW_STAGE_NOT_FOUND',
    status: 404,
    title: 'No such stage',
    detail: 'That stage is not part of this workflow.',
    retryable: false,
  });

export const taskNotFound = (): AppError =>
  new AppError({
    code: 'WORKFLOW_TASK_NOT_FOUND',
    status: 404,
    title: 'No such task',
    detail: 'That task is not part of this stage.',
    retryable: false,
  });

export const templateNotFound = (): AppError =>
  new AppError({
    code: 'WORKFLOW_TEMPLATE_NOT_FOUND',
    status: 404,
    title: 'No such template',
    detail: 'That workflow template does not exist.',
    retryable: false,
  });

/** The house rule's words (WP-20a). */
export const workflowVersionConflict = (): AppError =>
  new AppError({
    code: 'WORKFLOW_VERSION_CONFLICT',
    status: 409,
    title: 'Someone else changed this',
    detail: 'Someone else changed this — reload to see their change.',
    hint: 'Reload, then make your change again.',
    retryable: false,
  });

export const openTasks = (count: number): AppError =>
  new AppError({
    code: 'WORKFLOW_OPEN_TASKS',
    status: 422,
    title: 'This stage still has open tasks',
    detail: `${String(count)} ${count === 1 ? 'task is' : 'tasks are'} still open. Mark them done, or complete the stage anyway.`,
    count,
    retryable: false,
  });

export const blockedReasonRequired = (): AppError =>
  new AppError({
    code: 'WORKFLOW_BLOCKED_REASON_REQUIRED',
    status: 422,
    title: 'Say what is blocking it',
    detail: 'A blocked stage needs a reason of up to 200 characters.',
    retryable: false,
  });

export const templateReadOnly = (detail: string): AppError =>
  new AppError({
    code: 'WORKFLOW_TEMPLATE_READ_ONLY',
    status: 403,
    title: 'You cannot change this template',
    detail,
    hint: 'Clone it to make a copy of your own.',
    retryable: false,
  });

export const assigneeNotOnRoster = (): AppError =>
  new AppError({
    code: 'WORKFLOW_ASSIGNEE_NOT_ON_ROSTER',
    status: 422,
    title: 'Not on the roster',
    detail: 'Only students on this competition’s roster can be assigned work.',
    retryable: false,
  });
