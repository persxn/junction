import {
  problemType,
  type ErrorCode,
  type ProblemDetails,
  type ProblemFieldError,
} from '@compintel/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/** RFC 9457 media type used for every error body (ARCHITECTURE.md 4.4). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Correlates a response, its log entries and its problem body. */
export const REQUEST_ID_HEADER = 'x-request-id';

export interface AppErrorInit {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly retryable?: boolean;
  readonly errors?: readonly ProblemFieldError[];
  readonly cause?: unknown;
}

/**
 * An error the client is allowed to see. Everything it carries ends up in the
 * problem body verbatim, so it must never hold internals; unexpected throws are
 * mapped to a bare `INTERNAL` problem instead.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly hint: string | undefined;
  readonly retryable: boolean | undefined;
  readonly errors: readonly ProblemFieldError[] | undefined;

  constructor(init: AppErrorInit) {
    super(init.detail ?? init.title, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'AppError';
    this.code = init.code;
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.hint = init.hint;
    this.retryable = init.retryable;
    this.errors = init.errors;
  }

  toProblemDetails(requestId: string, instance?: string): ProblemDetails {
    return {
      type: problemType(this.code),
      title: this.title,
      status: this.status,
      code: this.code,
      requestId,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      ...(instance === undefined ? {} : { instance }),
      ...(this.hint === undefined ? {} : { hint: this.hint }),
      ...(this.retryable === undefined ? {} : { retryable: this.retryable }),
      ...(this.errors === undefined ? {} : { errors: [...this.errors] }),
    };
  }
}

export const notFound = (detail?: string): AppError =>
  new AppError({
    code: 'NOT_FOUND',
    status: 404,
    title: 'Not found',
    ...(detail === undefined ? {} : { detail }),
  });

export const unauthorized = (detail: string, hint?: string): AppError =>
  new AppError({
    code: 'UNAUTHORIZED',
    status: 401,
    title: 'Not authenticated',
    detail,
    ...(hint === undefined ? {} : { hint }),
  });

export const forbidden = (detail: string, hint?: string): AppError =>
  new AppError({
    code: 'FORBIDDEN',
    status: 403,
    title: 'Not allowed',
    detail,
    ...(hint === undefined ? {} : { hint }),
  });

export const validationFailed = (errors: readonly ProblemFieldError[]): AppError =>
  new AppError({
    code: 'VALIDATION_FAILED',
    status: 400,
    title: 'The request is not valid',
    detail: 'One or more values were rejected; see errors[] for the details.',
    errors,
  });

/** The only problem an unexpected throw may produce: no message, no stack, no internals. */
const internal = (): AppError =>
  new AppError({
    code: 'INTERNAL',
    status: 500,
    title: 'Something went wrong',
    detail: 'The request could not be completed. The details are in the backend log.',
    hint: 'Use Copy diagnostics and send the log to support.',
    retryable: true,
  });

/**
 * Fastify puts the validated section (`body`, `querystring`, ...) in `context`
 * and the JSON-pointer location in `instancePath`; the UI wants one dotted path.
 */
function fieldPath(section: string | undefined, instancePath: string | undefined): string {
  const tail = (instancePath ?? '').replace(/^\//, '').split('/').filter(Boolean).join('.');
  const head = section === 'querystring' ? 'query' : (section ?? '');
  return [head, tail].filter((part) => part.length > 0).join('.');
}

function toFieldErrors(error: unknown): ProblemFieldError[] {
  if (!hasZodFastifySchemaValidationErrors(error)) {
    return [];
  }
  const section = (error as { validationContext?: string }).validationContext;
  return error.validation.map((issue) => ({
    path: fieldPath(section, issue.instancePath),
    message: issue.message ?? 'Invalid value',
  }));
}

function sendProblem(reply: FastifyReply, request: FastifyRequest, error: AppError): FastifyReply {
  const problem = error.toProblemDetails(request.id, request.url);
  return reply.status(error.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

/**
 * Installs the one place errors become responses: `AppError` passes through,
 * schema failures become `VALIDATION_FAILED`, an unmatched route becomes
 * `NOT_FOUND`, and anything else becomes a bare `INTERNAL` with the real cause
 * logged but never serialized.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  app.setNotFoundHandler((request, reply) => {
    const error = notFound(`No route matches ${request.method} ${request.url}.`);
    request.log.info(
      { code: error.code, method: request.method, url: request.url },
      'route missed',
    );
    return sendProblem(reply, request, error);
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, status: error.status }, 'request rejected');
      return sendProblem(reply, request, error);
    }

    const fieldErrors = toFieldErrors(error);
    if (fieldErrors.length > 0) {
      const appError = validationFailed(fieldErrors);
      request.log.info({ code: appError.code, errors: fieldErrors }, 'request failed validation');
      return sendProblem(reply, request, appError);
    }

    // Fastify's own 4xx (bad JSON, body too large, unsupported media type) are
    // safe to surface as VALIDATION_FAILED; everything else is ours to hide.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const appError = new AppError({
        code: 'VALIDATION_FAILED',
        status,
        title: 'The request is not valid',
        detail: error.message,
      });
      request.log.info({ code: appError.code, status, fastifyCode: error.code }, 'request refused');
      return sendProblem(reply, request, appError);
    }

    request.log.error({ err: error }, 'unhandled error');
    return sendProblem(reply, request, internal());
  });
}
