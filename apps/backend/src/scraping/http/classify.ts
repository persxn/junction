import type { ScrapeErrorKind } from '@compintel/contracts';

import { TransportError } from './types.js';

/**
 * Node's error codes → §6.2's `error_kind` enum, and `Retry-After` → a number of
 * milliseconds.
 *
 * This file exists so the rest of the client never sees an undici internal. It
 * is also the one place the §7.7 distinction between "we could not reach them"
 * (NETWORK/DNS/TIMEOUT — retry, show the last update) and "their certificate is
 * invalid" (TLS — never worked around, shown as a refusal) is decided, and
 * getting that wrong would mean either a scraper that silently accepts a bad
 * certificate or one that retries a host that will never answer.
 */

/** OpenSSL's certificate verdicts, all of which mean "do not proceed". */
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'EPROTO',
]);

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA', 'EAI_NONAME']);

const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
]);

/** Walks `cause` chains, which is where undici puts the socket-level error. */
function codeOf(error: unknown, depth = 0): string | undefined {
  if (depth > 5 || error === null || typeof error !== 'object') {
    return undefined;
  }
  const candidate = error as { code?: unknown; cause?: unknown; name?: unknown };
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  if (typeof candidate.name === 'string' && candidate.name === 'AbortError') {
    return 'ABORT_ERR';
  }
  return codeOf(candidate.cause, depth + 1);
}

/** The error kind a thrown transport failure is recorded as. */
export function classifyTransportError(error: unknown): ScrapeErrorKind {
  if (error instanceof TransportError) {
    return error.kind;
  }
  const code = codeOf(error);
  if (code === undefined) {
    return 'NETWORK';
  }
  if (TLS_CODES.has(code)) {
    return 'TLS';
  }
  if (DNS_CODES.has(code)) {
    return 'DNS';
  }
  if (TIMEOUT_CODES.has(code) || code === 'ABORT_ERR') {
    return 'TIMEOUT';
  }
  return 'NETWORK';
}

/** Wraps any thrown value as a classified `TransportError`. */
export function asTransportError(error: unknown): TransportError {
  if (error instanceof TransportError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new TransportError(classifyTransportError(error), message, error);
}

/**
 * Which kind an HTTP status is. 403 is `BLOCKED` and not `HTTP_4XX`, because
 * §7.2 and R60 treat it as a decision by the site rather than a bad request:
 * it is never retried, and never with a different User-Agent.
 */
export function classifyStatus(status: number): ScrapeErrorKind {
  if (status === 429) {
    return 'RATE_LIMITED';
  }
  if (status === 403 || status === 401 || status === 451) {
    return 'BLOCKED';
  }
  if (status === 503) {
    return 'RATE_LIMITED';
  }
  if (status >= 500) {
    return 'HTTP_5XX';
  }
  if (status >= 400) {
    return 'HTTP_4XX';
  }
  return 'UNKNOWN';
}

/**
 * RFC 9110 `Retry-After`: either delta-seconds or an HTTP-date. A date in the
 * past means "now", never a negative wait. Anything unparseable is `undefined`
 * rather than a guessed default — waiting an invented amount of time is not more
 * polite than falling back to the normal backoff.
 */
export function parseRetryAfter(value: string | undefined, now: Date): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1_000;
  }
  // Every HTTP-date form starts with a day name; requiring one keeps `Date.parse`
  // from reading "-5" as the year 5 BC and answering "zero seconds".
  if (!/^[A-Za-z]{3}/.test(trimmed)) {
    return undefined;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) {
    return undefined;
  }
  return Math.max(0, at - now.getTime());
}

/** Paths a site sends a signed-out reader to (R74's "redirect to the login page"). */
const LOGIN_PATH = /\/(log[-_]?in|sign[-_]?in|signin|login|auth\/login)(\/|$|\?)/i;

/**
 * Whether a request for one page ended up on a sign-in page. Only asked when a
 * session was actually sent, so a site whose public page *is* `/login` (nobody's
 * is) cannot be mistaken for an expired session.
 */
export function isLoginRedirect(requested: string, finalUrl: string): boolean {
  if (finalUrl === requested) {
    return false;
  }
  try {
    return (
      LOGIN_PATH.test(new URL(finalUrl).pathname) && !LOGIN_PATH.test(new URL(requested).pathname)
    );
  } catch {
    return false;
  }
}
