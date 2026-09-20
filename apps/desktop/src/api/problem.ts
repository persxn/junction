import { ProblemDetails, type ErrorCode, type ProblemFieldError } from '@compintel/contracts';

/**
 * The one error type the UI handles (ARCHITECTURE.md §4.4, ruling R5).
 *
 * Everything that can go wrong with an API call arrives here: a `problem+json`
 * body the backend produced, a body that was not one, and a transport that never
 * reached the backend at all (`status` 0). Components switch on `code`, never on
 * `title` or `status` — the codes are part of the contract, the prose is not.
 */
export class ApiProblem extends Error {
  /** HTTP status, or 0 when nothing answered. */
  readonly status: number;
  readonly code: ErrorCode;
  /** Short summary, stable for a given code; safe to show as a heading. */
  readonly title: string;
  readonly detail: string | undefined;
  /** What the user can do about it. */
  readonly hint: string | undefined;
  /** Whether repeating the same request may succeed. */
  readonly retryable: boolean;
  /** Correlates with `X-Request-Id` and the backend log line. */
  readonly requestId: string | undefined;
  /** Field-level complaints; only meaningful for `VALIDATION_FAILED`. */
  readonly errors: readonly ProblemFieldError[];
  /** The request path, for diagnostics. */
  readonly path: string;

  constructor(init: {
    status: number;
    code: ErrorCode;
    title: string;
    path: string;
    detail?: string | undefined;
    hint?: string | undefined;
    retryable?: boolean | undefined;
    requestId?: string | undefined;
    errors?: readonly ProblemFieldError[] | undefined;
    cause?: unknown;
  }) {
    super(`${init.code} (${init.status.toString()}) on ${init.path}: ${init.title}`, {
      cause: init.cause,
    });
    this.name = 'ApiProblem';
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.path = init.path;
    this.detail = init.detail;
    this.hint = init.hint;
    this.retryable = init.retryable ?? defaultRetryable(init.status);
    this.requestId = init.requestId;
    this.errors = init.errors ?? [];
  }
}

/**
 * When the backend did not say, guess from the status: nothing answered, the
 * request timed out, we were throttled, or the server broke — those may work on a
 * second try. A 4xx will not.
 */
function defaultRetryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * Turns whatever came back into an `ApiProblem`.
 *
 * A body that is not a valid `problem+json` is itself a fault — a proxy, a crash
 * page, an HTML error — so it becomes `INTERNAL` rather than being guessed at.
 */
export function problemFromBody(status: number, path: string, body: unknown): ApiProblem {
  const parsed = ProblemDetails.safeParse(body);
  if (!parsed.success) {
    return new ApiProblem({
      status,
      code: 'INTERNAL',
      title: 'The background service returned something unexpected',
      detail: `The response to ${path} was not a problem+json body.`,
      path,
    });
  }
  const problem = parsed.data;
  return new ApiProblem({
    status: problem.status,
    code: problem.code,
    title: problem.title,
    path,
    detail: problem.detail,
    hint: problem.hint,
    retryable: problem.retryable,
    requestId: problem.requestId,
    errors: problem.errors,
  });
}

/** Nothing answered: the WebView could not reach the loopback API at all. */
export function unreachableProblem(path: string, cause: unknown): ApiProblem {
  return new ApiProblem({
    status: 0,
    code: 'INTERNAL',
    title: 'The app could not reach the background service',
    detail: cause instanceof Error ? cause.message : String(cause),
    hint: 'It may still be starting. Try again in a moment.',
    retryable: true,
    path,
    cause,
  });
}

export function isApiProblem(error: unknown): error is ApiProblem {
  return error instanceof ApiProblem;
}

/**
 * Optimistic concurrency (§4.4): the aggregate's `version` moved on, so the edit
 * was written against a stale copy. Callers re-read, show what changed and offer
 * to re-apply — they never retry blindly.
 */
export function isConflict(error: unknown): error is ApiProblem {
  return isApiProblem(error) && error.status === 409;
}

/** The session is missing or expired. The seam WP-07a hangs the lock screen on. */
export function isUnauthorized(error: unknown): error is ApiProblem {
  return isApiProblem(error) && error.status === 401;
}
