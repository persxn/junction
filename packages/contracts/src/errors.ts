import { z } from 'zod';

/**
 * Ruling R12: one closed `ErrorCode` enum, composed from per-domain lists so a
 * work package can add its own codes without touching anybody else's. Everything
 * outside the common list is prefixed with its domain (`DB_`, `SOURCE_`, and
 * later `AUTH_`, `SCRAPE_`, ...).
 */
export const COMMON_ERROR_CODES = [
  'INTERNAL',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
] as const;

/**
 * Authentication and session failures (§4.12, §10, rulings R33/R34/R38). Each
 * one is a different thing for the UI to say, which is why they are not all
 * `UNAUTHORIZED`: "wrong password", "locked for another 4 minutes" and "your
 * session expired while you were away" need different screens.
 */
export const AUTH_ERROR_CODES = [
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_ACCOUNT_DISABLED',
  'AUTH_SESSION_EXPIRED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTH_RECOVERY_INVALID',
] as const;

/**
 * First-run setup (§4.12, rulings R39-R43). `SETUP_REQUIRED` is the gate itself:
 * a 409 rather than a 401, because nothing is wrong with the caller - the
 * installation simply has no administrator yet.
 */
export const SETUP_ERROR_CODES = [
  'SETUP_REQUIRED',
  'SETUP_ALREADY_DONE',
  'SETUP_PATH_UNUSABLE',
  'SETUP_PASSPHRASE_WEAK',
] as const;

/** Event-source and scraping failures (§7.7). */
export const SOURCE_ERROR_CODES = ['SOURCE_UNREACHABLE'] as const;

/** Database failures the API may surface at request time (WP-04b). */
export const DB_ERROR_CODES = ['DB_UNAVAILABLE', 'DB_CONSTRAINT_VIOLATED'] as const;

/**
 * Stable, machine-readable error codes (ARCHITECTURE.md §4.4). The UI switches on
 * `code`, never on `title` or `status`, so these strings are part of the API contract.
 */
export const ERROR_CODES = [
  ...COMMON_ERROR_CODES,
  ...AUTH_ERROR_CODES,
  ...SETUP_ERROR_CODES,
  ...SOURCE_ERROR_CODES,
  ...DB_ERROR_CODES,
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Prefix of every `type` URN (ruling R5). */
export const PROBLEM_TYPE_PREFIX = 'urn:compintel:problem:';

/** The problem `type` URN for a code, e.g. `urn:compintel:problem:NOT_FOUND`. */
export function problemType(code: ErrorCode): string {
  return `${PROBLEM_TYPE_PREFIX}${code}`;
}

const PROBLEM_TYPE_PATTERN = /^urn:compintel:problem:[A-Z][A-Z0-9_]*$/;

/** One field-level complaint inside a `VALIDATION_FAILED` problem (ruling R5). */
export const ProblemFieldError = z.object({
  /** Dotted location of the offending value, e.g. `body.name` or `query.limit`. */
  path: z.string(),
  /** Human-readable explanation of what is wrong with that value. */
  message: z.string().min(1),
});
export type ProblemFieldError = z.infer<typeof ProblemFieldError>;

/**
 * RFC 9457 `application/problem+json` body as fixed by ruling R5: `type`, `title`,
 * `status`, `code` and `requestId` are always present; everything else is optional.
 */
export const ProblemDetails = z.object({
  /** `urn:compintel:problem:<code>` — a stable URI identifying the problem type. */
  type: z.string().regex(PROBLEM_TYPE_PATTERN),
  /** Short human-readable summary, stable for a given `type`. */
  title: z.string().min(1),
  /** HTTP status code generated on the origin server. */
  status: z.int().min(100).max(599),
  /** The code the UI switches on. */
  code: ErrorCode,
  /** Correlates the response with the `X-Request-Id` header and the log entry. */
  requestId: z.string().min(1),
  /** Human-readable explanation specific to this occurrence. */
  detail: z.string().min(1).optional(),
  /** URI identifying this specific occurrence (usually the request path). */
  instance: z.string().min(1).optional(),
  /** What the user can do about it. */
  hint: z.string().min(1).optional(),
  /** Whether retrying the same request may succeed. */
  retryable: z.boolean().optional(),
  /** Field-level complaints; only meaningful for `VALIDATION_FAILED`. */
  errors: z.array(ProblemFieldError).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
