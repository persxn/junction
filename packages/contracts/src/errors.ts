import { z } from 'zod';

/**
 * Ruling R12: one closed `ErrorCode` enum, composed from per-domain lists so a
 * work package can add its own codes without touching anybody else's. Everything
 * outside the common list is prefixed with its domain, and every domain is named
 * in `ERROR_CODE_DOMAINS` below.
 *
 * The M1 blocks (`EVENT_`, `GEO_`, `SEARCH_`, `IMPORT_`) are declared here in
 * advance of the code that raises them. That is deliberate: a work package that
 * has to invent an error code mid-flight invents an inconsistent one, and the UI
 * switches on these strings, so they are part of the API contract.
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

/**
 * Event-source and scraping failures (§7.7, §7.2). The compliance gate is a
 * refusal by *us*, not by the site, which is why it is not an HTTP-shaped code:
 * the answer the user needs is "this source is not approved for scraping", not
 * "403".
 *
 * WP-09a replaced the placeholder `SOURCE_NOT_APPROVED` with
 * `SOURCE_BLOCKED_BY_POLICY`, which is §7.7's own name for the row it maps to
 * and covers the three refusals that share one message — not approved,
 * disabled, or outside `allowed_paths_json`. Nothing consumed the old name.
 * `SOURCE_SETUP_INCOMPLETE` is A10/R44: the wizard has not recorded a contact
 * address, so no request may be made at all.
 */
export const SOURCE_ERROR_CODES = [
  'SOURCE_NOT_FOUND',
  'SOURCE_UNREACHABLE',
  'SOURCE_BLOCKED_BY_POLICY',
  'SOURCE_ROBOTS_DISALLOWED',
  'SOURCE_RATE_LIMITED',
  'SOURCE_SCHEMA_CHANGED',
  'SOURCE_PARSE_FAILED',
  'SOURCE_REFRESH_TOO_SOON',
  'SOURCE_SETUP_INCOMPLETE',
  /** WP-12: a host an adapter must never contact (`api.devfolio.co`); refused before the transport. */
  'SOURCE_HOST_FORBIDDEN',
  /** WP-13: a path an adapter must never request (Unstop profiles, register pages, private `/api/*`). */
  'SOURCE_PATH_FORBIDDEN',
] as const;

/**
 * Events, and the merge/override decisions on top of them (§6.2 Events, §7.5,
 * §7.6). `EVENT_STALE_VERSION` is the optimistic-concurrency 409 from §6.1's
 * `version` column; `EVENT_MERGE_CONFLICT` is two events that cannot be merged
 * because a field disagrees in a way only a person can settle.
 */
export const EVENT_ERROR_CODES = [
  'EVENT_NOT_FOUND',
  'EVENT_INVALID_CANDIDATE',
  'EVENT_VERSION_CONFLICT',
  'EVENT_ALREADY_MERGED',
  'EVENT_MERGE_CONFLICT',
  'EVENT_NOT_MERGED',
  'EVENT_INVALID_DATES',
  'EVENT_OVERRIDE_INVALID',
  /** WP-10: an event cannot be merged into itself. */
  'EVENT_MERGE_SELF',
  /** WP-10: a dedup candidate that has already been merged or rejected. */
  'EVENT_CANDIDATE_DECIDED',
] as const;

/**
 * Geography and the offline gazetteer (§4.17, §7.4). A place the gazetteer does
 * not know is `GEO_PLACE_UNKNOWN` and is *not* an error the user caused: §6.1's
 * "unknown is not false" applies to locations too, and the event stays, flagged.
 */
export const GEO_ERROR_CODES = [
  'GEO_GAZETTEER_UNAVAILABLE',
  'GEO_PLACE_UNKNOWN',
  'GEO_COORDINATES_INVALID',
  'GEO_POLICY_INVALID',
] as const;

/**
 * Search and the `EventQuery` DSL (§8). WP-15a renamed the placeholder
 * `SEARCH_QUERY_INVALID` to `SEARCH_INVALID_QUERY`, the name its prompt fixes;
 * nothing had raised the old one.
 */
export const SEARCH_ERROR_CODES = [
  'SEARCH_INVALID_QUERY',
  'SEARCH_INDEX_UNAVAILABLE',
  'SEARCH_TOO_BROAD',
  'SEARCH_SAVED_NOT_FOUND',
  /** WP-15a: a cursor this backend did not issue, was altered, or belongs to another query. */
  'SEARCH_INVALID_CURSOR',
  /** WP-15a: `text` over its 200 characters (§8.1). */
  'SEARCH_TEXT_TOO_LONG',
  /** WP-15a: an alias for this term exists and `replace` was not set. */
  'SEARCH_ALIAS_EXISTS',
  /** WP-15b: a category rule whose pattern cannot mean anything for its kind. */
  'SEARCH_INVALID_RULE',
  /** WP-15b: a REGEX rule that could backtrack without bound (nested unbounded quantifiers). */
  'SEARCH_RULE_PATTERN_UNSAFE',
] as const;

/**
 * The category list and its rules (§6.2 Taxonomy, D-15, WP-15b). The rule
 * *pattern* codes sit with search, where the prompt fixes them; this block is
 * the categories themselves.
 */
export const CATEGORY_ERROR_CODES = [
  /** WP-15b: events carry the category; delete with `?reassign=` or deactivate it. */
  'CATEGORY_IN_USE',
] as const;

/**
 * Manual and URL import (§7, D-31): the path Devpost and Unstop take, since
 * WP-02 ruled them MANUAL_IMPORT_ONLY. `IMPORT_SOURCE_NOT_ALLOWED` is the
 * URL-import restriction, not a network failure.
 */
export const IMPORT_ERROR_CODES = [
  'IMPORT_FILE_UNREADABLE',
  'IMPORT_FORMAT_UNSUPPORTED',
  'IMPORT_SOURCE_NOT_ALLOWED',
  'IMPORT_ROW_INVALID',
  'IMPORT_TOO_LARGE',
  /** WP-14: not a URL we will follow — not https, an IP literal, `file:`/`data:`. */
  'IMPORT_URL_INVALID',
  /** WP-14/D-30: the domain is MANUAL_IMPORT_ONLY or BLOCKED, so nothing was requested. */
  'IMPORT_DOMAIN_MANUAL_ONLY',
  /** WP-14: the host's robots.txt disallows the page; it was not fetched. */
  'IMPORT_ROBOTS_DISALLOWED',
  /** WP-14: the page was read and held nothing an event could be built from. */
  'IMPORT_EXTRACTION_FAILED',
  /** WP-14: the URL answered with something that is not HTML (a PDF, an image). */
  'IMPORT_UNSUPPORTED_CONTENT',
  /** WP-14: the per-user preview limit; the import is user-initiated, so it has one. */
  'IMPORT_RATE_LIMITED',
] as const;

/**
 * Students, mentorships and the student import (WP-17, rulings R91–R93).
 * `STUDENT_IMPORT_PREVIEW_EXPIRED` is R93's 410: the preview is in memory, so a
 * restart or 30 quiet minutes ends it.
 */
export const STUDENT_ERROR_CODES = [
  'STUDENT_NOT_FOUND',
  'STUDENT_UNIVERSITY_ID_TAKEN',
  'STUDENT_PHONE_DISABLED',
  'STUDENT_EXTERNAL_DISABLED',
  'STUDENT_ERASED',
  'STUDENT_VERSION_CONFLICT',
  'STUDENT_ALREADY_MENTORED',
  'STUDENT_MENTORSHIP_NOT_FOUND',
  'STUDENT_IMPORT_PREVIEW_EXPIRED',
  'STUDENT_IMPORT_FILE_INVALID',
  'STUDENT_IMPORT_TOO_LARGE',
] as const;

/** Teams (WP-18, R94–R95). */
export const TEAM_ERROR_CODES = [
  'TEAM_NOT_FOUND',
  'TEAM_NAME_TAKEN',
  'TEAM_ARCHIVED',
  'TEAM_VERSION_CONFLICT',
  'TEAM_MEMBER_EXISTS',
  'TEAM_MEMBER_NOT_FOUND',
  'TEAM_STUDENT_NOT_ACTIVE',
  'TEAM_MENTOR_NOT_PROFESSOR',
  'TEAM_MENTOR_EXISTS',
  'TEAM_MENTOR_NOT_FOUND',
  'TEAM_LEAD_NOT_MEMBER',
  /** WP-19: archiving a team that still has an open competition. */
  'TEAM_HAS_ACTIVE_COMPETITIONS',
] as const;

/**
 * Competitions (WP-19, R96–R98). The prefix is the table's name, `ENGAGEMENT_`;
 * what a person reads says "competition".
 */
export const ENGAGEMENT_ERROR_CODES = [
  'ENGAGEMENT_NOT_FOUND',
  'ENGAGEMENT_INVALID_TRANSITION',
  'ENGAGEMENT_STUDENT_ALREADY_ACTIVE',
  'ENGAGEMENT_TEAM_ALREADY_ASSIGNED',
  'ENGAGEMENT_EVENT_MERGED',
  'ENGAGEMENT_CLOSED',
  'ENGAGEMENT_EMPTY_ROSTER',
  'ENGAGEMENT_MENTOR_EXISTS',
  'ENGAGEMENT_MENTOR_NOT_FOUND',
  'ENGAGEMENT_PARTICIPANT_NOT_FOUND',
  'ENGAGEMENT_VERSION_CONFLICT',
] as const;

/** Workflows, stages, tasks and templates (WP-20a, R99–R101). */
export const WORKFLOW_ERROR_CODES = [
  'WORKFLOW_NOT_FOUND',
  'WORKFLOW_STAGE_NOT_FOUND',
  'WORKFLOW_TASK_NOT_FOUND',
  'WORKFLOW_TEMPLATE_NOT_FOUND',
  'WORKFLOW_VERSION_CONFLICT',
  /** Completing a stage with open tasks needs CLOSE or KEEP; carries `count`. */
  'WORKFLOW_OPEN_TASKS',
  'WORKFLOW_BLOCKED_REASON_REQUIRED',
  'WORKFLOW_TEMPLATE_READ_ONLY',
  'WORKFLOW_ASSIGNEE_NOT_ON_ROSTER',
] as const;

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
  ...EVENT_ERROR_CODES,
  ...GEO_ERROR_CODES,
  ...SEARCH_ERROR_CODES,
  ...CATEGORY_ERROR_CODES,
  ...IMPORT_ERROR_CODES,
  ...STUDENT_ERROR_CODES,
  ...TEAM_ERROR_CODES,
  ...ENGAGEMENT_ERROR_CODES,
  ...WORKFLOW_ERROR_CODES,
  ...DB_ERROR_CODES,
] as const;

/**
 * The prefix every non-common code carries, and the list a test checks against.
 * A new domain is added here at the same time as its block, so "which domains
 * exist" has one answer rather than being inferred from the strings.
 */
export const ERROR_CODE_DOMAINS = [
  'AUTH',
  'SETUP',
  'SOURCE',
  'EVENT',
  'GEO',
  'SEARCH',
  'CATEGORY',
  'IMPORT',
  'STUDENT',
  'TEAM',
  'ENGAGEMENT',
  'WORKFLOW',
  'DB',
] as const;
export type ErrorCodeDomain = (typeof ERROR_CODE_DOMAINS)[number];

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
  /** `ENGAGEMENT_INVALID_TRANSITION`: the statuses the competition may move to (R97). */
  allowed: z.array(z.string().min(1)).optional(),
  /**
   * The records the problem is about — the competition a student is already in,
   * the merged event's survivor, a team's open competitions (WP-19).
   */
  related: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).optional(),
  /** `WORKFLOW_OPEN_TASKS`: how many tasks are still open. */
  count: z.int().min(0).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
