import type { ComplianceStatus, ScrapeErrorKind, ScrapeMethod } from '@compintel/contracts';

import type { GateRefusal } from '../../domain/scraping/gate.js';

/**
 * The seam every request goes through (§7.1: the PoliteHttpClient is the only
 * network access an adapter has).
 *
 * The transport is injected rather than imported so that the whole suite runs
 * offline: every test in `pnpm verify` passes a fake `Fetcher` or a `node:http`
 * server on 127.0.0.1, and nothing opens an internet socket. The real one,
 * `undiciFetcher`, is wired in `main.ts` and nowhere else.
 *
 * The body is an async iterable rather than a buffer on purpose. §4.8's 5 MB cap
 * says a response is "aborted, never buffered past it", which is only true if
 * the client can stop reading — and that has to be provable on the fake, which
 * it is: a fake that yields ten 1 MB chunks is asked for five.
 */

/** Longest a connection may take to establish (§4.8). */
export const CONNECT_TIMEOUT_MS = 10_000;

/** Longest one request may take from start to last byte (§4.8). */
export const TOTAL_TIMEOUT_MS = 30_000;

/** Response size cap (§4.8). Reading stops here; nothing larger is held. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** §7.2's retry allowance: two, and only for the kinds below. */
export const MAX_RETRIES = 2;

/**
 * First retry delay; the second is twice this, both with jitter. A retry also
 * waits at least the host's effective delay, so with §7.2's 3-second floor the
 * first step is spent waiting for politeness rather than for backoff.
 */
export const RETRY_BASE_MS = 2_000;

/** Kinds a retry could plausibly fix. Everything else is answered once. */
export const RETRYABLE_ERROR_KINDS: readonly ScrapeErrorKind[] = [
  'NETWORK',
  'DNS',
  'TIMEOUT',
  'HTTP_5XX',
];

/** How long robots.txt is trusted, per host (§7.2). */
export const ROBOTS_TTL_MS = 24 * 3_600_000;

/** R61: a reachability probe is cached this long, so a run makes at most one. */
export const REACHABILITY_TTL_MS = 5 * 60_000;

export interface TransportRequest {
  readonly url: string;
  readonly method: ScrapeMethod;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly connectTimeoutMs: number;
  readonly totalTimeoutMs: number;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** After redirects, if the transport followed any. */
  readonly url: string;
  readonly body: AsyncIterable<Uint8Array>;
}

export type Fetcher = (request: TransportRequest) => Promise<TransportResponse>;

/**
 * A transport-level failure, already classified. The undici adapter turns
 * Node's error codes into one of these so nothing above this file has to know
 * what `UND_ERR_CONNECT_TIMEOUT` means; a fake transport throws them directly.
 */
export class TransportError extends Error {
  readonly kind: ScrapeErrorKind;

  constructor(kind: ScrapeErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'TransportError';
    this.kind = kind;
  }
}

/**
 * What the client throws. Everything a run needs to write its `scrape_runs` row
 * is on it: the `error_kind` column, the HTTP status when there was one, and the
 * gate refusal when we are the ones who said no.
 */
export class ScrapeRequestError extends Error {
  readonly kind: ScrapeErrorKind;
  readonly status: number | undefined;
  readonly refusal: GateRefusal | undefined;
  /** Set for 429/503 with a `Retry-After` we could not wait out. */
  readonly retryAfterMs: number | undefined;

  constructor(init: {
    kind: ScrapeErrorKind;
    message: string;
    status?: number;
    refusal?: GateRefusal;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ScrapeRequestError';
    this.kind = init.kind;
    this.status = init.status;
    this.refusal = init.refusal;
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** One response, already read, capped and hashed. */
export interface PoliteResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  /** True for a 304: the body is empty and the caller's copy is current. */
  readonly notModified: boolean;
  /** SHA-256 of the body, hex. Empty string for a 304. */
  readonly contentHash: string;
  text(): string;
  json(): unknown;
}

/** Everything the gate needs to know about the source making the request. */
export interface SourceRequestContext {
  readonly key: string;
  readonly name: string;
  readonly complianceStatus: ComplianceStatus;
  readonly isEnabled: boolean;
  readonly allowedPaths: readonly string[];
  readonly minDelayMs: number;
  readonly maxRequestsPerRun: number;
}

export interface RequestOptions {
  /** Send `If-None-Match` / `If-Modified-Since` from `http_cache` (§7.2). */
  readonly conditional?: boolean;
  readonly method?: ScrapeMethod;
  readonly accept?: string;
  /** Aborted when the backend shuts down; every wait honours it. */
  readonly signal?: AbortSignal;
}

/** Pauses without a real timer in tests. `ms` is never negative. */
export type Sleeper = (ms: number, signal?: AbortSignal) => Promise<void>;

export const realSleeper: Sleeper = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
