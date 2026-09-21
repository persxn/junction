import { AppError } from '../../platform/errors.js';

/** The categories module's problems (R12). Rule-pattern codes are `SEARCH_` by the prompt's naming. */

export const invalidRule = (detail: string): AppError =>
  new AppError({
    code: 'SEARCH_INVALID_RULE',
    status: 400,
    title: 'The rule is not valid',
    detail,
  });

export const unsafeRulePattern = (detail: string): AppError =>
  new AppError({
    code: 'SEARCH_RULE_PATTERN_UNSAFE',
    status: 400,
    title: 'The rule pattern could hang classification',
    detail,
    hint: 'Avoid repeating a group that already repeats, such as (a+)+.',
  });

export const categoryInUse = (name: string, count: number): AppError =>
  new AppError({
    code: 'CATEGORY_IN_USE',
    status: 409,
    title: 'The category is in use',
    detail: `${String(count)} event assignment(s) use "${name}".`,
    hint: 'Pass ?reassign=<category id> to move them, or deactivate the category instead.',
    retryable: false,
  });
