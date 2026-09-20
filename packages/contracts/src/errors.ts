import { z } from 'zod';

/**
 * Stable, machine-readable error codes (ARCHITECTURE.md §4.4). The UI switches on
 * `code`, never on `title` or `status`, so these strings are part of the API contract.
 */
export const ERROR_CODES = [
  'INTERNAL',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'SOURCE_UNREACHABLE',
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * RFC 9457 `application/problem+json` body, plus the three CompIntel extensions
 * the spec requires: a stable `code`, an optional human `hint` and an optional
 * `retryable` flag (§4.4).
 */
export const ProblemDetails = z.object({
  /** URI identifying the problem type; `about:blank` when there is no specific type. */
  type: z.url(),
  /** Short human-readable summary, stable for a given `type`. */
  title: z.string().min(1),
  /** HTTP status code generated on the origin server. */
  status: z.int().min(100).max(599),
  /** Human-readable explanation specific to this occurrence. */
  detail: z.string(),
  /** URI identifying this specific occurrence (request path or request id). */
  instance: z.string().min(1),
  /** CompIntel extension: the code the UI switches on. */
  code: ErrorCode,
  /** CompIntel extension: what the user can do about it. */
  hint: z.string().min(1).optional(),
  /** CompIntel extension: whether retrying the same request may succeed. */
  retryable: z.boolean().optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
