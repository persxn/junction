import type { ScrapeMethod } from '@compintel/contracts';
import type { Logger } from 'pino';

import { assessRequest, effectiveDelayMs, refusalErrorKind } from '../../domain/scraping/gate.js';
import type { RobotsVerdict } from '../../domain/scraping/gate.js';
import { applyJitter } from '../../domain/scheduling.js';
import type { Clock } from '../../platform/time.js';
import type { ValidatorStore } from './cache.js';
import { asTransportError, classifyStatus, parseRetryAfter } from './classify.js';
import { hostKey } from './queue.js';
import type { HostQueue } from './queue.js';
import { decode, readCapped } from './read.js';
import type { RobotsCache } from './robots.js';
import {
  CONNECT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_RETRIES,
  REACHABILITY_TTL_MS,
  RETRY_BASE_MS,
  RETRYABLE_ERROR_KINDS,
  ScrapeRequestError,
  TOTAL_TIMEOUT_MS,
  type Fetcher,
  type PoliteResponse,
  type RequestOptions,
  type Sleeper,
  type SourceRequestContext,
  type TransportResponse,
} from './types.js';

/**
 * The `PoliteHttpClient` of §4.8 and §7.2 — one per scrape run, because the
 * request budget is per run.
 *
 * Every request passes the compliance gate twice: once before robots.txt is
 * known, to answer the questions that do not need it, and once after. Then it
 * goes through the per-host queue, which enforces the effective delay and the
 * one-in-flight rule. Only then is a socket opened, and only through the
 * injected `Fetcher`.
 *
 * The retry rules are §7.2's, not a general-purpose HTTP client's. A 403 is
 * answered once, with the same User-Agent, and recorded `BLOCKED` (R60). A TLS
 * failure is answered once and never worked around. A 429 or 503 is obeyed:
 * `Retry-After` is honoured when it fits in the run, and reported as
 * `RATE_LIMITED` when it does not.
 */

/** What the client is allowed to spend on one run. */
export interface RequestBudget {
  readonly maxRequests: number;
  /** Longest single `Retry-After` wait the run will sit through (§7.2). */
  readonly maxWaitMs: number;
}

/** The process-wide machinery a per-run client borrows. */
export interface HttpEnvironment {
  readonly fetcher: Fetcher;
  readonly queue: HostQueue;
  readonly robots: RobotsCache;
  readonly cache: ValidatorStore | undefined;
  readonly clock: Clock;
  readonly sleep: Sleeper;
  readonly logger: Logger;
  readonly random: () => number;
  /** `CompIntel/<version> (+mailto:…)`, read at request time (A10). */
  readonly userAgent: () => string;
  /** False until the wizard has finished *and* recorded a contact address. */
  readonly setupComplete: () => boolean;
  /** R23's interface-table check: no network call. */
  readonly hasNetworkInterface: () => boolean;
  /** R61: shared across runs so a probe happens at most once per 5 minutes. */
  readonly reachability: Map<string, { at: number; reachable: boolean }>;
}

export class PoliteHttpClient {
  readonly #env: HttpEnvironment;
  readonly #source: SourceRequestContext;
  readonly #budget: RequestBudget;
  readonly #signal: AbortSignal;
  /** Hosts whose robots.txt could not be read; skipped for the rest of the run. */
  readonly #unreadableHosts = new Set<string>();
  #requestsMade = 0;

  constructor(
    env: HttpEnvironment,
    source: SourceRequestContext,
    budget: RequestBudget,
    signal: AbortSignal,
  ) {
    this.#env = env;
    this.#source = source;
    this.#budget = budget;
    this.#signal = signal;
  }

  /** Requests the adapter has made; this is what `scrape_runs.requests_made` records. */
  get requestsMade(): number {
    return this.#requestsMade;
  }

  get requestsRemaining(): number {
    return Math.max(0, this.#budget.maxRequests - this.#requestsMade);
  }

  get(url: string, options: RequestOptions = {}): Promise<PoliteResponse> {
    return this.#request(url, 'GET', options);
  }

  head(url: string, options: RequestOptions = {}): Promise<PoliteResponse> {
    return this.#request(url, 'HEAD', options);
  }

  /**
   * R23's cheap first answer: does this machine have a usable network interface?
   * No packet is sent, so a laptop on a train answers instantly and its runs are
   * `SKIPPED_OFFLINE` rather than a failure streak (D-23).
   */
  isOnline(): boolean {
    return this.#env.hasNetworkInterface();
  }

  /**
   * R61's confirming probe: a HEAD to the source's own host, through the gate
   * and the politeness queue like any other request, cached for five minutes so
   * a run costs at most one. Offline is not a failure, so a probe that fails
   * answers `false` rather than throwing.
   */
  async isReachable(url: string): Promise<boolean> {
    if (!this.isOnline()) {
      return false;
    }
    let key: string;
    try {
      key = hostKey(new URL(url));
    } catch {
      return false;
    }
    const now = this.#env.clock.now().getTime();
    const cached = this.#env.reachability.get(key);
    if (cached !== undefined && now - cached.at < REACHABILITY_TTL_MS) {
      return cached.reachable;
    }
    let reachable: boolean;
    try {
      const response = await this.head(url);
      reachable = response.status < 500;
    } catch (error) {
      reachable = error instanceof ScrapeRequestError && error.kind === 'BLOCKED';
      this.#env.logger.debug({ host: key }, 'reachability probe failed');
    }
    this.#env.reachability.set(key, { at: this.#env.clock.now().getTime(), reachable });
    return reachable;
  }

  async #request(
    rawUrl: string,
    method: ScrapeMethod,
    options: RequestOptions,
  ): Promise<PoliteResponse> {
    // First pass: everything that does not need robots.txt. A source that may
    // not be scraped at all never reaches the code that would fetch robots.
    this.#assert(rawUrl, method, 'UNKNOWN');
    const url = new URL(rawUrl);
    const key = hostKey(url);
    const preDelay = effectiveDelayMs(this.#source.minDelayMs, undefined);

    if (this.#unreadableHosts.has(key)) {
      throw this.#refused(
        'ROBOTS_DISALLOWED',
        `robots.txt on ${url.host} could not be read earlier in this run.`,
      );
    }
    const robots = await this.#env.robots.lookup(url, preDelay, options.signal ?? this.#signal);
    if (robots.unreachable) {
      this.#unreadableHosts.add(key);
    }
    this.#assert(rawUrl, method, robots.verdict);

    const delay = effectiveDelayMs(this.#source.minDelayMs, robots.crawlDelaySeconds);
    return this.#env.queue.run(
      key,
      delay,
      () => this.#attempts(url, method, options, delay),
      options.signal ?? this.#signal,
    );
  }

  /** Runs the gate and turns a refusal into the error a run records. */
  #assert(url: string, method: ScrapeMethod, robots: RobotsVerdict): void {
    const decision = assessRequest({
      complianceStatus: this.#source.complianceStatus,
      isEnabled: this.#source.isEnabled,
      allowedPaths: this.#source.allowedPaths,
      robots,
      url,
      method,
      setupComplete: this.#env.setupComplete(),
      requestsMade: this.#requestsMade,
      cap: this.#budget.maxRequests,
    });
    if (!decision.allowed) {
      this.#env.logger.info(
        { source: this.#source.key, refusal: decision.refusal },
        'a request was refused by the compliance gate',
      );
      throw new ScrapeRequestError({
        kind: refusalErrorKind(decision.refusal),
        message: decision.reason,
        refusal: decision.refusal,
      });
    }
  }

  #refused(refusal: 'ROBOTS_DISALLOWED', message: string): ScrapeRequestError {
    return new ScrapeRequestError({ kind: 'ROBOTS_DISALLOWED', message, refusal });
  }

  /** The attempt loop. At most `MAX_RETRIES` extra tries, and only for §7.2's kinds. */
  async #attempts(
    url: URL,
    method: ScrapeMethod,
    options: RequestOptions,
    delayMs: number,
  ): Promise<PoliteResponse> {
    let lastError: ScrapeRequestError | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (this.#requestsMade >= this.#budget.maxRequests) {
        throw (
          lastError ??
          new ScrapeRequestError({
            kind: 'UNKNOWN',
            message: `This run has already made its ${this.#budget.maxRequests} requests.`,
            refusal: 'REQUEST_CAP_REACHED',
          })
        );
      }
      this.#requestsMade += 1;
      try {
        return await this.#once(url, method, options);
      } catch (error) {
        if (!(error instanceof ScrapeRequestError)) {
          throw error;
        }
        lastError = error;
        const wait = this.#retryDelay(error, attempt, delayMs);
        if (wait === undefined) {
          throw error;
        }
        this.#env.logger.debug(
          { url: url.toString(), kind: error.kind, attempt: attempt + 1, waitMs: wait },
          'retrying a request',
        );
        await this.#env.sleep(wait, options.signal ?? this.#signal);
      }
    }
    throw lastError ?? new ScrapeRequestError({ kind: 'UNKNOWN', message: 'No attempt was made.' });
  }

  /**
   * How long to wait before trying again, or `undefined` for "do not".
   *
   * `Retry-After` wins where the server sent one, and a wait the run cannot
   * afford ends the request as `RATE_LIMITED` rather than being silently
   * shortened — asking again sooner than we were told to is the opposite of
   * honouring it.
   *
   * Every other retry waits the larger of the exponential step and the host's
   * effective delay. A retry is another request, so the crawl-delay applies to
   * it exactly as it does to a first attempt; with §7.2's 3-second floor that
   * makes the first step 3 s rather than 2 s.
   */
  #retryDelay(error: ScrapeRequestError, attempt: number, delayMs: number): number | undefined {
    if (attempt >= MAX_RETRIES) {
      return undefined;
    }
    if (error.kind === 'RATE_LIMITED') {
      const asked = error.retryAfterMs;
      if (asked === undefined) {
        return undefined;
      }
      return asked <= this.#budget.maxWaitMs ? Math.max(asked, delayMs) : undefined;
    }
    if (!RETRYABLE_ERROR_KINDS.includes(error.kind)) {
      return undefined;
    }
    return Math.max(applyJitter(RETRY_BASE_MS * 2 ** attempt, 0.25, this.#env.random), delayMs);
  }

  /** One request, one response, no retrying. */
  async #once(url: URL, method: ScrapeMethod, options: RequestOptions): Promise<PoliteResponse> {
    const target = url.toString();
    const conditional = options.conditional === true ? this.#env.cache?.get(target) : undefined;
    const headers: Record<string, string> = {
      'user-agent': this.#env.userAgent(),
      accept: options.accept ?? 'application/json, text/html;q=0.9, */*;q=0.5',
      'accept-encoding': 'gzip, deflate',
    };
    if (conditional?.etag != null) {
      headers['if-none-match'] = conditional.etag;
    }
    if (conditional?.lastModified != null) {
      headers['if-modified-since'] = conditional.lastModified;
    }

    let response: TransportResponse;
    try {
      response = await this.#env.fetcher({
        url: target,
        method,
        headers,
        signal: options.signal ?? this.#signal,
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        totalTimeoutMs: TOTAL_TIMEOUT_MS,
      });
    } catch (error) {
      const transport = asTransportError(error);
      throw new ScrapeRequestError({
        kind: transport.kind,
        message: `${method} ${target} failed: ${transport.message}`,
        cause: error,
      });
    }

    const now = this.#env.clock.now().getTime();
    if (response.status === 304) {
      this.#env.cache?.touch(target, now);
      return frozen({
        status: 304,
        url: target,
        headers: response.headers,
        body: new Uint8Array(0),
        notModified: true,
        contentHash: '',
      });
    }
    if (response.status >= 400) {
      throw this.#statusError(response, target, method);
    }

    const { body, contentHash } = await readCapped(response, MAX_RESPONSE_BYTES).catch(
      (error: unknown) => {
        const transport = asTransportError(error);
        throw new ScrapeRequestError({
          kind: transport.kind,
          message: `${method} ${target} failed while reading: ${transport.message}`,
          cause: error,
        });
      },
    );
    this.#env.cache?.put(
      target,
      { etag: header(response, 'etag'), lastModified: header(response, 'last-modified') },
      contentHash,
      now,
    );
    return frozen({
      status: response.status,
      url: response.url,
      headers: response.headers,
      body,
      notModified: false,
      contentHash,
    });
  }

  #statusError(
    response: TransportResponse,
    target: string,
    method: ScrapeMethod,
  ): ScrapeRequestError {
    const kind = classifyStatus(response.status);
    const retryAfterMs = parseRetryAfter(header(response, 'retry-after'), this.#env.clock.now());
    return new ScrapeRequestError({
      kind,
      status: response.status,
      message: `${method} ${target} answered ${response.status}.`,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
}

/** Header lookup by a name the linter would rather see in dot notation. */
function header(response: TransportResponse, name: string): string | undefined {
  return response.headers[name];
}

/** Adds the two lazy accessors and freezes the result. */
function frozen(base: Omit<PoliteResponse, 'text' | 'json'>): PoliteResponse {
  return Object.freeze({
    ...base,
    text: () => decode(base.body),
    json: () => JSON.parse(decode(base.body)) as unknown,
  });
}
