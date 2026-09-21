import { EventQuery, SEARCH_TEXT_MAX, type ProblemFieldError } from '@compintel/contracts';

import { AppError } from '../../platform/errors.js';

/**
 * Search's problems (R12: `SEARCH_`-prefixed, in contracts' closed enum).
 *
 * The search body is parsed here rather than by Fastify's schema step, so a bad
 * query answers `SEARCH_INVALID_QUERY` — the code the filter UI, saved searches
 * and the AI planner switch on — instead of the generic `VALIDATION_FAILED`.
 */

export const invalidQuery = (detail: string, errors?: readonly ProblemFieldError[]): AppError =>
  new AppError({
    code: 'SEARCH_INVALID_QUERY',
    status: 400,
    title: 'The search query is not valid',
    detail,
    ...(errors === undefined ? {} : { errors }),
  });

export const textTooLong = (): AppError =>
  new AppError({
    code: 'SEARCH_TEXT_TOO_LONG',
    status: 400,
    title: 'The search text is too long',
    detail: `Search text is limited to ${String(SEARCH_TEXT_MAX)} characters.`,
    hint: 'Shorten the text, or move part of it into a filter.',
  });

export const invalidCursor = (): AppError =>
  new AppError({
    code: 'SEARCH_INVALID_CURSOR',
    status: 400,
    title: 'This page of results is no longer valid',
    detail: 'The cursor was not issued by this backend for this query, or it was altered.',
    hint: 'Run the search again from the first page.',
  });

export const aliasExists = (term: string): AppError =>
  new AppError({
    code: 'SEARCH_ALIAS_EXISTS',
    status: 409,
    title: 'That alias already exists',
    detail: `An alias for "${term}" already exists.`,
    hint: 'Send "replace": true to overwrite it.',
    retryable: false,
  });

/** `EventQuery` from an untrusted body, or the problem the caller should see. */
export function parseEventQuery(body: unknown): EventQuery {
  const parsed = EventQuery.safeParse(body ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues;
  if (
    issues.some(
      (issue) => issue.path.length === 1 && issue.path[0] === 'text' && issue.code === 'too_big',
    )
  ) {
    throw textTooLong();
  }
  throw invalidQuery(
    'One or more parts of the query were rejected; see errors[] for the details.',
    issues.map((issue) => ({
      path: ['body', ...issue.path.map(String)].join('.'),
      message: issue.message,
    })),
  );
}
